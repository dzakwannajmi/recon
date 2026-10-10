/**
 * The paid detail body (`check-detail/1`, spec 2.4): the evidence bundle for one asset.
 * Everything comes from stored files plus one simulated read of the testnet feed entry.
 * Flags, statuses, and statements are relayed from the status file, never computed here
 * (golden rule 1). Anything that does not recompute throws an `IntegrityError`: the paid
 * route then answers 500 and the settlement is cancelled (spec 3.4).
 */
import { claimsFor } from "../agent-data/claims";
import type { UniverseAsset } from "../chain/universe";
import type { Claim } from "../claims/store";
import type { LoadedAsset, LoadedStatus } from "../factsheet/load";
import { entryMatches, fileFieldsOf, parseStatusFile, toUpdate, type Entry, type StatusFile as FeedStatusFile, type Update } from "../feed/encode";
import { FLAG_BITS, FLAG_ORDER } from "../flags/types";
import { CHECKS_UNAVAILABLE_REASON, ISSUER_ACCOUNTS_NOTE, NOTICE, UNTRUSTED_NOTE } from "./copy";
import type { GatewayData } from "./data";
import { FEED_NETWORK } from "./summary";

export const DETAIL_SCHEMA = "check-detail/1";
export const MAX_DETAIL_BYTES = 64 * 1024;
export const MAX_CLAIMS_IN_DETAIL = 25;
export const MAX_QUOTE_CODE_POINTS = 1000;
export const MAX_EVIDENCE_PER_FLAG = 10;
export const MAX_SIGNERS = 20;
export const MAX_SOURCES = 20;
export const ONCHAIN_DEADLINE_MS = 4000;
export const ONCHAIN_CACHE_TTL_MS = 60_000;

/** A stored file that does not recompute or is incomplete. Never sold: the caller answers 500 and cancels the settlement. */
export class IntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntegrityError";
  }
}

/** A bigint as a JSON number when safe, else as a string (the same rule as the response writer). */
const jsonInt = (v: bigint): number | string => (v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v.toString());

/** The first `max` code points; `truncated` says whether anything was cut (never splits a surrogate pair). */
export function cutCodePoints(text: string, max: number): { text: string; truncated: boolean } {
  const chars = Array.from(text);
  return chars.length <= max ? { text, truncated: false } : { text: chars.slice(0, max).join(""), truncated: true };
}

// ---------------------------------------------------------------- the feed entry on chain

export type EntryReader = { readEntries(keys: readonly string[]): Promise<(Entry | null)[]> };
export type OnchainRead = { read: "ok" | "not_found" | "unavailable"; read_at: string; entry: Entry | null };
export type OnchainCache = Map<string, { at: number; result: OnchainRead }>;

/** Shared across requests of one server instance. Only successful reads are stored. */
const sharedCache: OnchainCache = new Map();

/**
 * One simulated `get_many` for a key, with a deadline. A timeout or an RPC error is `unavailable`
 * and is not cached; a successful read (an entry, or none) is cached for 60 seconds.
 */
export async function readOnchain(
  key: string,
  reader: EntryReader,
  now: Date,
  opts: { cache?: OnchainCache; ttlMs?: number; deadlineMs?: number } = {},
): Promise<OnchainRead> {
  const cache = opts.cache ?? sharedCache;
  const ttlMs = opts.ttlMs ?? ONCHAIN_CACHE_TTL_MS;
  const hit = cache.get(key);
  if (hit && now.getTime() - hit.at < ttlMs && now.getTime() >= hit.at) return hit.result;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const entries = await Promise.race([
      reader.readEntries([key]),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("deadline")), opts.deadlineMs ?? ONCHAIN_DEADLINE_MS);
      }),
    ]);
    const entry = entries[0] ?? null;
    const result: OnchainRead = { read: entry ? "ok" : "not_found", read_at: now.toISOString(), entry };
    cache.set(key, { at: now.getTime(), result });
    return result;
  } catch {
    return { read: "unavailable", read_at: now.toISOString(), entry: null };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const entryJson = (e: Entry) => ({
  version: e.version,
  status: e.status,
  flags: e.flags,
  evidence_hash: e.evidence_hash,
  as_of: jsonInt(e.as_of),
  issuer_change_seen_at: jsonInt(e.issuer_change_seen_at),
  published_ledger: e.published_ledger,
});

// ---------------------------------------------------------------- the stored chain checks

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const strList = (v: unknown, max: number): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, max) : []);

function chainFacts(loaded: LoadedStatus, asset: LoadedAsset, data: Pick<GatewayData, "checks">) {
  const input = loaded.status.inputs.checks;
  const source_file = input?.path ?? null;
  const unavailable = (reason: string) => ({ source_file, available: false as const, reason });
  if (!input) return unavailable(CHECKS_UNAVAILABLE_REASON);
  const file = data.checks(input.path);
  if (!file || file.sha256 !== input.sha256) return unavailable(CHECKS_UNAVAILABLE_REASON);
  const row = file.rows.find((r) => r.asset_code === asset.asset_code && r.issuer === asset.issuer);
  if (!row) return unavailable("no row for this asset in the checks file");
  const identity = isObj(row.identity) ? row.identity : {};
  const facts = isObj(row.facts) ? row.facts : {};
  const signers = (Array.isArray(facts.issuerSigners) ? facts.issuerSigners : [])
    .filter((s): s is { key: string; weight: number } => isObj(s) && typeof s.key === "string" && typeof s.weight === "number")
    .map((s) => ({ key: s.key, weight: s.weight }))
    .sort((a, b) => b.weight - a.weight || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .slice(0, MAX_SIGNERS);
  const top = isObj(facts.largestHolder) && typeof facts.largestHolder.address === "string"
    ? { address: facts.largestHolder.address, share_percent: num(facts.largestHolder.sharePercent) }
    : null;
  return {
    source_file,
    source_sha256: file.sha256,
    available: true as const,
    identity: {
      status: str(identity.status),
      severity: str(identity.severity),
      reason: str(identity.reason),
      home_domain: str(identity.homeDomain),
      official_domains: strList(identity.officialDomains, MAX_SOURCES),
      code_listed_in_toml: typeof identity.codeListed === "boolean" ? identity.codeListed : null,
      toml_sha256: str(identity.tomlSha256),
      toml_parse_mode: str(identity.tomlParseMode),
      checked_at: str(identity.checkedAt),
    },
    facts: {
      exists: typeof facts.exists === "boolean" ? facts.exists : null,
      supply: str(facts.supply),
      supply_breakdown: isObj(facts.supplyBreakdown) ? facts.supplyBreakdown : null,
      authorized_trustlines: num(facts.authorizedTrustlines),
      funded_holders: num(facts.fundedHolders),
      flags: isObj(facts.flags) ? facts.flags : null,
      issuer_signers: signers,
      issuer_thresholds: isObj(facts.issuerThresholds) ? facts.issuerThresholds : null,
      largest_holder: top,
      checked_at: str(facts.checkedAt),
      sources: strList(facts.sources, MAX_SOURCES),
    },
    notes: [ISSUER_ACCOUNTS_NOTE],
  };
}

// ---------------------------------------------------------------- flags

function flagItems(asset: LoadedAsset) {
  return FLAG_ORDER.map((flag) => {
    const raised = asset.raised.find((f) => f.flag === flag);
    const clear = asset.clear.find((f) => f.flag === flag);
    const notEvaluated = asset.not_evaluated.find((f) => f.flag === flag);
    const hit = raised ?? clear ?? notEvaluated;
    if (!hit) throw new IntegrityError(`${asset.asset}: the status file has no entry for the flag ${flag}`);
    const evidence = raised?.evidence ?? clear?.evidence ?? [];
    return {
      flag,
      bit: FLAG_BITS[flag],
      outcome: hit.outcome,
      severity: raised ? raised.severity : null,
      effective_severity: raised ? raised.effective_severity : null,
      review: raised ? raised.review : null,
      text: raised ? raised.statement : (clear?.reason ?? notEvaluated?.reason ?? ""),
      as_of: raised?.as_of ?? clear?.as_of ?? null,
      evidence: evidence.slice(0, MAX_EVIDENCE_PER_FLAG).map((e) => ({
        kind: e.kind ?? null,
        ref: e.ref ?? null,
        source_url: e.source_url ?? null,
        snapshot_sha256: e.snapshot_sha256 ?? null,
        quote: e.quote ?? null,
        where: e.where ?? null,
      })),
    };
  });
}

// ---------------------------------------------------------------- the whole body

const feedStatusCache = new WeakMap<object, FeedStatusFile>();
function feedStatus(loaded: LoadedStatus): FeedStatusFile {
  let parsed = feedStatusCache.get(loaded.status);
  if (!parsed) {
    try {
      parsed = parseStatusFile(loaded.status);
    } catch (e) {
      throw new IntegrityError((e as Error).message);
    }
    feedStatusCache.set(loaded.status, parsed);
  }
  return parsed;
}

const INPUT_NAMES = ["checks", "previous_checks", "examinations", "claims", "sources", "snapshots", "reviews"] as const;

function evidenceInputs(inputs: Record<string, unknown>) {
  const out: { name: string; path: string; sha256: string }[] = [];
  const add = (name: string, v: unknown) => {
    if (isObj(v) && typeof v.path === "string" && typeof v.sha256 === "string") out.push({ name, path: v.path, sha256: v.sha256 });
  };
  for (const name of INPUT_NAMES) add(name, inputs[name]);
  if (Array.isArray(inputs.checks_history)) for (const item of inputs.checks_history) add("checks_history", item);
  return out;
}

export type DetailInput = {
  asset: LoadedAsset;
  row: UniverseAsset | null;
  loaded: LoadedStatus;
  claims: Claim[];
  universe: UniverseAsset[];
  data: Pick<GatewayData, "checks" | "deployment" | "publishedBy">;
  /** Reads the feed entry; null when no reader could be built (the read is then `unavailable`). */
  reader: EntryReader | null;
  now: Date;
  onchainCache?: OnchainCache;
  onchainDeadlineMs?: number;
};

export async function buildDetail(input: DetailInput) {
  const { asset, row, loaded, data, now } = input;
  if (asset.status === null || asset.status_code === undefined || asset.status_code === null) {
    throw new IntegrityError(`${asset.asset}: the asset has no published status`);
  }
  const deployment = data.deployment();
  if (!deployment) throw new IntegrityError("The feed deployment record is missing or invalid");

  // toUpdate also runs checkIntegrity: the evidence hash and the SAC key must recompute.
  const file = feedStatus(loaded);
  const feedAsset = file.assets.find((a) => a.asset === asset.asset);
  if (!feedAsset) throw new IntegrityError(`${asset.asset}: the asset is not in the status file`);
  let expected: Update;
  try {
    expected = toUpdate(fileFieldsOf(file), feedAsset);
  } catch (e) {
    throw new IntegrityError((e as Error).message);
  }

  const flags = flagItems(asset);

  const matched = claimsFor(input.claims, input.universe, asset.asset_code, asset.issuer);
  const claimItems = matched.slice(0, MAX_CLAIMS_IN_DETAIL).map(({ claim: c, about }) => {
    const q = cutCodePoints(c.quote, MAX_QUOTE_CODE_POINTS);
    return {
      field: c.field,
      value: c.value,
      value_text: c.value_text,
      unit: c.unit ?? null,
      as_of: c.as_of ?? null,
      quote: q.text,
      quote_truncated: q.truncated,
      source_url: c.source_url,
      source_class: c.source_class,
      page: c.page ?? null,
      snapshot_sha256: c.snapshot_sha256,
      text_sha256: c.text_sha256,
      field_source: c.field_source,
      about,
    };
  });

  const key = expected.asset;
  const onchain = input.reader
    ? await readOnchain(key, input.reader, now, { cache: input.onchainCache, deadlineMs: input.onchainDeadlineMs })
    : ({ read: "unavailable", read_at: now.toISOString(), entry: null } as OnchainRead);
  const diffs = onchain.entry ? entryMatches(onchain.entry, expected) : onchain.read === "not_found" ? ["no entry for this key on the feed"] : null;
  const publishedBy = data.publishedBy(key, asset.evidence_hash, deployment.contract_id);

  const inputs = loaded.status.inputs as unknown as Record<string, unknown>;
  const statusFile = `data/status/${loaded.file}`;

  return {
    schema: DETAIL_SCHEMA,
    generated_at: now.toISOString(),
    asset: {
      code: asset.asset_code,
      issuer: asset.issuer,
      issuer_org: asset.issuer_org,
      type: asset.asset_type,
      official_domain: row?.official_domain || null,
      sac_contract_id: asset.sac_contract_id ?? null,
    },
    status: {
      value: asset.status,
      code: asset.status_code,
      flags_bitmask: asset.flags_bitmask,
      flags_binary: asset.flags_bitmask.toString(2).padStart(FLAG_ORDER.length, "0"),
      as_of: loaded.status.as_of,
      checked_at: asset.checked_at ?? null,
      issuer_change_seen_at: asset.issuer_change_seen_at ?? null,
      rules_version: loaded.status.rules_version,
    },
    flags,
    claims: { total: matched.length, returned: claimItems.length, items: claimItems },
    chain_facts: chainFacts(loaded, asset, data),
    feed: {
      network: FEED_NETWORK,
      contract_id: deployment.contract_id,
      key,
      expected: {
        status: expected.status,
        flags: expected.flags,
        evidence_hash: expected.evidence_hash,
        as_of: jsonInt(expected.as_of),
        issuer_change_seen_at: jsonInt(expected.issuer_change_seen_at),
      },
      onchain: {
        read: onchain.read,
        read_at: onchain.read_at,
        entry: onchain.entry ? entryJson(onchain.entry) : null,
        matches: diffs === null ? null : diffs.length === 0,
        diffs,
      },
      published_by: publishedBy,
    },
    evidence: {
      evidence_hash: asset.evidence_hash,
      status_file: statusFile,
      inputs: evidenceInputs(inputs),
      reproduce: publishedBy
        ? `At commit ${publishedBy.commit}, run \`npm run status -- --as-of ${loaded.status.as_of}\` and compare evidence_hash.`
        : `In a checkout that contains ${statusFile}, run \`npm run status -- --as-of ${loaded.status.as_of}\` and compare evidence_hash.`,
    },
    untrusted_text: UNTRUSTED_NOTE,
    notice: NOTICE,
  };
}
