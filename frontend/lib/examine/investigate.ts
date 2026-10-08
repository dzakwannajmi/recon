/**
 * Bounded, read-only investigations (deterministic). Each step records the
 * query it made and what it found; conclusions state facts and the limits of
 * the data, never intent (golden rule 4).
 */
import { formatStroops, toStroops } from "../chain/asset";
import { fetchTrustedJson } from "../chain/http";
import { HORIZON_MAINNET } from "../chain/horizon";

const MAX_PAGES = 10;
const PAGE_SIZE = 200;

export type InvestigationStep = { step: string; query: string | null; finding: string; data?: unknown };
export type Investigation = { asset: string; check: string; started_at: string; steps: InvestigationStep[]; conclusion: string; limits: string[] };

type Op = {
  type: string;
  created_at: string;
  transaction_hash: string;
  from?: string;
  to?: string;
  amount?: string;
  asset_code?: string;
  asset_issuer?: string;
  source_amount?: string;
  source_asset_code?: string;
  source_asset_issuer?: string;
  selling_asset_code?: string;
  selling_asset_issuer?: string;
  buying_asset_code?: string;
  buying_asset_issuer?: string;
  asset?: string; // "CODE:ISSUER" on create_claimable_balance
  reserves_max?: { asset: string }[];
  reserves_deposited?: { asset: string }[];
  reserves_min?: { asset: string }[];
  reserves_received?: { asset: string }[];
  funder?: string;
};
type Page = { _embedded: { records: Op[] }; _links?: { next?: { href: string } } };

function isHorizonUrl(href: string) {
  try {
    return new URL(href).origin === HORIZON_MAINNET;
  } catch {
    return false;
  }
}

/** Read up to MAX_PAGES pages of an issuer's operations or payments, oldest first. */
async function readAll(path: "payments" | "operations", issuer: string, signal?: AbortSignal) {
  const records: Op[] = [];
  const first = `${HORIZON_MAINNET}/accounts/${encodeURIComponent(issuer)}/${path}?order=asc&limit=${PAGE_SIZE}`;
  let url: string | undefined = first;
  let pages = 0;
  let truncated = false;
  while (url && pages < MAX_PAGES) {
    const page: Page = await fetchTrustedJson<Page>(url, { signal });
    records.push(...page._embedded.records);
    pages++;
    if (page._embedded.records.length < PAGE_SIZE) {
      url = undefined;
      break;
    }
    const next = page._links?.next?.href;
    url = next && isHorizonUrl(next) ? next : undefined;
    if (!url) truncated = true; // a full page with no usable next link: there may be more
  }
  if (url) truncated = true;
  return { records, truncated, query: first };
}

/** Does this operation involve the asset (as payment, path source, offer side, or claimable balance)? */
function involves(op: Op, code: string, issuer: string) {
  const is = (c?: string, i?: string) => c === code && i === issuer;
  return (
    is(op.asset_code, op.asset_issuer) || is(op.source_asset_code, op.source_asset_issuer) || is(op.selling_asset_code, op.selling_asset_issuer) ||
    is(op.buying_asset_code, op.buying_asset_issuer) || op.asset === `${code}:${issuer}` ||
    [op.reserves_max, op.reserves_deposited, op.reserves_min, op.reserves_received].some((list) => list?.some((r) => r.asset === `${code}:${issuer}`))
  );
}

/** Claimable-balance operations that name a balance id only: their asset can't be told from the record. */
const UNRESOLVED_TYPES = new Set(["claim_claimable_balance", "clawback_claimable_balance"]);

/**
 * A supply mismatch: where the supply sits, issuance and redemption from the
 * issuer's payment history (with the window it covers), and other
 * operations that move the asset.
 */
export async function investigateSupplyMismatch(input: {
  asset: string; // CODE:ISSUER
  check: string;
  supply: string;
  breakdown: Record<string, string> | undefined;
  /** The documented amount in tokens, as a decimal string. */
  reference: { label: string; tokens: string };
  signal?: AbortSignal;
  now?: string;
}): Promise<Investigation> {
  const [code, issuer] = input.asset.split(":");
  const steps: InvestigationStep[] = [];
  const limits: string[] = [];

  // 1. Where the supply sits.
  const nonZero = Object.entries(input.breakdown ?? {}).filter(([, v]) => toStroops(v) !== 0n);
  steps.push({
    step: "supply_breakdown",
    query: `${HORIZON_MAINNET}/assets?asset_code=${code}&asset_issuer=${issuer}`,
    finding: nonZero.length ? `Supply ${input.supply} is held as: ${nonZero.map(([k, v]) => `${k} ${v}`).join(", ")}.` : `Supply ${input.supply}; no breakdown available.`,
    data: input.breakdown,
  });

  // 2. Does Horizon's history include the issuer's creation? (Decides what the totals below can say.)
  const operations = await readAll("operations", issuer, input.signal);
  const firstOp = operations.records[0];
  const complete = firstOp?.type === "create_account" && !operations.truncated;
  if (firstOp?.type !== "create_account") {
    limits.push(`Horizon's history for the issuer starts at ${firstOp?.created_at.slice(0, 10) ?? "an unknown date"} and does not include the account's creation, so earlier issuance is not visible here.`);
  }
  if (operations.truncated) limits.push(`Only the first ${operations.records.length} issuer operations were read; more exist.`);

  // 3. Issuance and redemption by payments.
  const payments = await readAll("payments", issuer, input.signal);
  if (payments.truncated) limits.push(`Only the first ${payments.records.length} issuer payments were read; more exist.`);
  let minted = 0n;
  let burned = 0n;
  let mints = 0;
  let burns = 0;
  let firstOver: Op | null = null;
  const threshold = toStroops(input.reference.tokens);
  for (const op of payments.records) {
    const isPath = op.type.startsWith("path_payment");
    if (op.from === issuer) {
      // The issuer can't hold its own asset: what it sends of it is newly issued.
      const sentOwn = isPath ? op.source_asset_code === code && op.source_asset_issuer === issuer : op.asset_code === code && op.asset_issuer === issuer;
      if (sentOwn) {
        minted += toStroops(isPath ? op.source_amount : op.amount);
        mints++;
      }
    } else if (op.to === issuer && op.asset_code === code && op.asset_issuer === issuer) {
      burned += toStroops(op.amount);
      burns++;
    }
    if (complete && !firstOver && minted - burned > threshold) firstOver = op;
  }
  const from = payments.records[0]?.created_at ?? null;
  const to = payments.records.at(-1)?.created_at ?? null;
  steps.push({
    step: "issuance_history",
    query: payments.query,
    finding:
      `${payments.records.length} issuer payments${from ? ` from ${from.slice(0, 10)} to ${to!.slice(0, 10)}` : ""}: ` +
      `${mints} issuing ${code} (${formatStroops(minted)}) and ${burns} returning it to the issuer (${formatStroops(burned)}).` +
      (firstOver ? ` Net issuance first exceeded ${input.reference.tokens} on ${firstOver.created_at.slice(0, 10)} (tx ${firstOver.transaction_hash}).` : ""),
    data: { records: payments.records.length, from, to, mints, burns, minted: formatStroops(minted), burned: formatStroops(burned), complete },
  });

  // 4. Other operations that move this asset.
  const relevant = ["clawback", "clawback_claimable_balance", "create_claimable_balance", "claim_claimable_balance", "manage_sell_offer", "manage_buy_offer", "create_passive_sell_offer", "liquidity_pool_deposit", "liquidity_pool_withdraw"];
  const counts: Record<string, number> = {};
  let contractCalls = 0;
  let unresolved = 0;
  for (const op of operations.records) {
    if (op.type === "invoke_host_function") contractCalls++;
    else if (UNRESOLVED_TYPES.has(op.type) && !op.asset) unresolved++;
    else if (relevant.includes(op.type) && involves(op, code, issuer)) counts[op.type] = (counts[op.type] ?? 0) + 1;
  }
  if (contractCalls) limits.push(`${contractCalls} smart-contract calls by the issuer were not decoded; Stellar Asset Contract mints or burns are not counted here.`);
  if (unresolved) limits.push(`${unresolved} claimable-balance claims or clawbacks by the issuer name only a balance id, so their asset is not known here.`);
  steps.push({
    step: "other_operations",
    query: operations.query,
    finding: Object.keys(counts).length
      ? `Other issuer operations involving ${code}: ${Object.entries(counts).map(([t, n]) => `${t} ×${n}`).join(", ")}.`
      : `No clawback, claimable-balance, offer, or pool operations by the issuer involving ${code} in the history read.`,
    data: { first_operation: firstOp?.type ?? null, first_operation_at: firstOp?.created_at ?? null, counts, contract_calls: contractCalls },
  });

  const conclusion =
    `On-chain supply ${input.supply} differs from ${input.reference.label} (${input.reference.tokens} tokens). ` +
    (mints > 0
      ? `The issuer's payment history read here shows ${mints} issuing payment(s) of ${code} and ${burns} returning it.`
      : complete
        ? `The issuer's full payment history shows no issuing payment of ${code}; it was issued by other operations.`
        : `The issuer's payment history read here (from ${from?.slice(0, 10) ?? "an unknown date"}) shows no issuing payment of ${code}; it was issued before that history or by other operations.`);
  return { asset: input.asset, check: input.check, started_at: input.now ?? new Date().toISOString(), steps, conclusion, limits };
}

/** Lines that are table headers or appear in almost every SEP-1 file; they say nothing about who wrote a toml. */
const BOILERPLATE = /^\[|^(VERSION|NETWORK_PASSPHRASE|display_decimals|is_asset_anchored|is_unlimited|status|anchor_asset_type)\s*=|^\s*$/;

/** Distinctive lines (not comments or boilerplate) of a document that also appear in a reference: count and share. */
export function lineStats(text: string, reference: string) {
  const lines = (t: string) => new Set(t.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && !BOILERPLATE.test(l)));
  const mine = lines(text);
  const theirs = lines(reference);
  let shared = 0;
  for (const l of mine) if (theirs.has(l)) shared++;
  return { shared, ratio: mine.size === 0 ? 0 : shared / mine.size };
}

/** Share of a document's distinctive lines that also appear in a reference document. */
export function lineOverlap(text: string, reference: string) {
  return lineStats(text, reference).ratio;
}

/** ORG_NAME from the [DOCUMENTATION] table of an untrusted toml: one line, at most 120 visible characters. */
export function orgName(toml: string) {
  const doc = /^\s*\[DOCUMENTATION\]\s*$([\s\S]*?)(?=^\s*\[|(?![\s\S]))/m.exec(toml)?.[1] ?? "";
  const raw = /^\s*ORG_NAME\s*=\s*"([^"\n]{0,120})"\s*$/m.exec(doc)?.[1];
  // Control, bidi-override, and zero-width characters can disguise a name; drop them with < and >.
  return raw ? raw.replace(/[\u0000-\u001f\u007f<>\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, " ").replace(/\s+/g, " ").trim() || null : null;
}

/**
 * An issuer that uses a pinned asset's code without verifying against the
 * pinned asset's domain. Facts only: who funded the account and when, its
 * footprint, and how its stellar.toml compares with the pinned issuer's.
 */
export async function investigateIdentityMismatch(input: {
  code: string;
  issuer: string;
  status: string;
  homeDomain: string | null;
  pinned: { issuer: string; org: string; domain: string };
  trustlines: number;
  supply: string | null;
  toml: { url: string; text: string; sha256: string } | null;
  officialToml: { url: string; text: string; sha256: string } | null;
  signal?: AbortSignal;
  now?: string;
}): Promise<Investigation> {
  const steps: InvestigationStep[] = [];
  const limits: string[] = [];
  const asset = `${input.code}:${input.issuer}`;
  const pinnedLabel = `${input.code}:${input.pinned.issuer} (${input.pinned.org}, ${input.pinned.domain})`;

  steps.push({
    step: "identity",
    query: `${HORIZON_MAINNET}/accounts/${input.issuer}`,
    finding: `Shares the code ${input.code} with the pinned asset ${pinnedLabel}; its home_domain is ${input.homeDomain ?? "(none)"}; identity status ${input.status}.`,
  });

  const opsUrl = `${HORIZON_MAINNET}/accounts/${encodeURIComponent(input.issuer)}/operations?order=asc&limit=1`;
  const first = (await fetchTrustedJson<Page>(opsUrl, { signal: input.signal }))._embedded.records[0];
  if (first?.type === "create_account") {
    steps.push({ step: "account_origin", query: opsUrl, finding: `Account created on ${first.created_at.slice(0, 10)} by ${first.funder} (tx ${first.transaction_hash}).`, data: { funder: first.funder, created_at: first.created_at } });
  } else {
    steps.push({ step: "account_origin", query: opsUrl, finding: `The earliest operation in Horizon's history is ${first?.type ?? "unknown"} on ${first?.created_at.slice(0, 10) ?? "an unknown date"}.` });
    limits.push("Horizon's history does not include this account's creation.");
  }

  steps.push({
    step: "footprint",
    query: `${HORIZON_MAINNET}/assets?asset_code=${input.code}&asset_issuer=${input.issuer}`,
    finding: `${input.trustlines} authorized trustlines; total supply ${input.supply ?? "unknown"}.`,
  });

  if (input.toml) {
    const org = orgName(input.toml.text);
    const officialOrg = input.officialToml ? orgName(input.officialToml.text) : null;
    const overlap = input.officialToml ? lineOverlap(input.toml.text, input.officialToml.text) : null;
    steps.push({
      step: "toml_comparison",
      query: input.toml.url,
      finding:
        `The stellar.toml at ${input.homeDomain}` +
        (org ? ` states ORG_NAME "${org}"${officialOrg ? (org === officialOrg ? ", the same as the pinned issuer's toml" : `; the pinned issuer's toml states "${officialOrg}"`) : ""}` : " states no ORG_NAME") +
        (overlap !== null ? `; ${Math.round(overlap * 100)}% of its distinctive lines also appear in the pinned issuer's toml (${input.officialToml!.url}).` : "."),
      data: { sha256: input.toml.sha256, org_name: org, official_org_name: officialOrg, line_overlap: overlap },
    });
  } else {
    steps.push({ step: "toml_comparison", query: null, finding: `No stellar.toml could be read at ${input.homeDomain ?? "(no home_domain)"}.` });
  }

  const conclusion = `Issuer ${input.issuer} shares the code ${input.code} with the pinned asset ${pinnedLabel}; its home_domain is ${input.homeDomain ?? "(none)"}. ${steps
    .filter((s) => s.step !== "identity")
    .map((s) => s.finding)
    .join(" ")}`;
  return { asset, check: `issuer_identity:${input.status}`, started_at: input.now ?? new Date().toISOString(), steps, conclusion, limits };
}
