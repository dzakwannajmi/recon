/**
 * Feed encoding (D-039, spec 3.1 and 3.2): one status-file asset to the contract `Update`,
 * the `Entry` decoder, and the contract error table. Pure: no network, no clock, no keys.
 *
 * Node runtime only. Nothing under `agent/` or `app/api/agent` may import this folder
 * (golden rule 1): the status comes from `lib/flags`, publishing only from `scripts/publish-feed.ts`.
 */
import { nativeToScVal, scValToNative, xdr } from "@stellar/stellar-sdk";
import { z } from "zod";
import { sacContractId } from "../chain/asset";
import { assetEvidenceHash, type FileFields, type HashedAsset } from "../flags/status";
import { FEED_SCHEMA, STATUS_CODES, isIsoTime } from "../flags/types";

/** The most `publish` and `get_many` accept in one call (`MAX_BATCH` in the contract). */
export const MAX_BATCH = 25;

/** Contract error codes: public ABI, same numbers as `FeedError` in contracts/feed/src/lib.rs. */
export const FEED_ERROR_NAMES = {
  1: "NotInitialized",
  2: "NoPendingAdmin",
  10: "EmptyBatch",
  11: "BatchTooLarge",
  12: "DuplicateAsset",
  13: "InvalidStatus",
  14: "UnknownFlagBits",
  15: "StatusFlagsMismatch",
  16: "MissingChangeTime",
  17: "ZeroEvidenceHash",
  18: "InvalidAsOf",
  19: "AsOfInFuture",
  20: "ChangeAfterAsOf",
  30: "StaleAsOf",
  31: "AlreadyPublished",
  32: "ChangeTimeWentBack",
  40: "TooManyAssets",
} as const;
export type FeedErrorCode = keyof typeof FEED_ERROR_NAMES;
export type FeedErrorName = (typeof FEED_ERROR_NAMES)[FeedErrorCode];

export function feedErrorName(code: number): FeedErrorName | null {
  return Object.prototype.hasOwnProperty.call(FEED_ERROR_NAMES, code) ? FEED_ERROR_NAMES[code as FeedErrorCode] : null;
}

/** The contract error code in an RPC simulation or host error text, e.g. `HostError: Error(Contract, #30)` → 30. */
export function contractErrorCode(text: string): number | null {
  const m = /Error\(Contract,\s*#(\d+)\)/.exec(text);
  return m ? Number(m[1]) : null;
}

export type FeedErrorKind = "contract" | "simulation" | "rejected" | "failed" | "timeout";

/** A failed feed call. `code` and `errorName` are set when the contract itself rejected the call. */
export class FeedError extends Error {
  constructor(
    message: string,
    readonly kind: FeedErrorKind,
    readonly code: number | null = null,
    readonly txHash: string | null = null,
  ) {
    super(message);
    this.name = "FeedError";
  }
  get errorName(): FeedErrorName | null {
    return this.code === null ? null : feedErrorName(this.code);
  }
}

/** Build the typed error for a text that may carry a contract error code. */
export function feedErrorFromText(text: string, kind: Exclude<FeedErrorKind, "contract"> = "simulation", txHash: string | null = null): FeedError {
  const code = contractErrorCode(text);
  if (code === null) return new FeedError(text, kind, null, txHash);
  const name = feedErrorName(code);
  return new FeedError(`contract error #${code}${name ? ` (${name})` : " (unknown code)"}`, "contract", code, txHash);
}

/** What the contract takes, one per asset. Times are unix seconds. `evidence_hash` is lowercase hex here, 32 raw bytes on chain. */
export type Update = {
  asset: string;
  status: number;
  flags: number;
  evidence_hash: string;
  as_of: bigint;
  issuer_change_seen_at: bigint;
};

/** What the contract returns for a key. */
export type Entry = Update & { version: number; published_ledger: number };

const HEX32 = /^[0-9a-f]{64}$/;
const U32_MAX = 0xffff_ffff;
const U64_MAX = (1n << 64n) - 1n;

/** The status-file fields the feed needs from one asset. Everything else in the asset is hashed verbatim. */
const statusAssetSchema = z.object({
  asset: z.string().min(1),
  sac_contract_id: z.string().min(1),
  status: z.enum(["OK", "WARNING", "CRITICAL"]).nullable(),
  status_code: z.union([z.literal(0), z.literal(1), z.literal(2)]).nullable(),
  checked_at: z.string().nullable(),
  flags_bitmask: z.number().int().min(0).max(U32_MAX),
  issuer_change_seen_at: z.string().nullable(),
  evidence_hash: z.string(),
  raised: z.array(z.unknown()),
  clear: z.array(z.unknown()),
  not_evaluated: z.array(z.unknown()),
}).loose();

export const statusFileSchema = z.object({
  as_of: z.string().min(1),
  feed_schema: z.number().int(),
  rules_version: z.string().min(1),
  inputs: z.unknown(),
  assets: z.array(statusAssetSchema),
}).loose();

export type StatusAsset = z.infer<typeof statusAssetSchema>;
export type StatusFile = z.infer<typeof statusFileSchema>;

/** Parse a status file; a missing or mistyped field throws (nothing is published from a file we can't read). */
export function parseStatusFile(json: unknown): StatusFile {
  const parsed = statusFileSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`The status file is invalid: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  return parsed.data;
}

/** The fields hashed with every asset (spec 3.4). */
export const fileFieldsOf = (f: Pick<StatusFile, "feed_schema" | "rules_version" | "inputs">): FileFields => ({
  feed_schema: f.feed_schema, rules_version: f.rules_version, inputs: f.inputs,
});

/** `floor(Date.parse(iso) / 1000)` as a bigint; a time that is not in the canonical ISO form throws. */
export function isoToUnix(iso: string, what: string): bigint {
  if (!isIsoTime(iso)) throw new Error(`${what} is not a valid ISO time: ${String(iso)}`);
  return BigInt(Math.floor(Date.parse(iso) / 1000));
}

/**
 * The evidence hash and the feed key of an asset must be what Part B computes from the file
 * (spec 8.1, precondition 5). One implementation of each: `assetEvidenceHash` and `sacContractId`.
 */
export function checkIntegrity(file: FileFields, a: StatusAsset): void {
  const [code, ...rest] = a.asset.split(":");
  const issuer = rest.join(":");
  const derived = sacContractId(code, issuer);
  if (derived !== a.sac_contract_id) {
    throw new Error(`${a.asset}: sac_contract_id ${a.sac_contract_id} does not match the contract ID derived from the code and issuer (${derived})`);
  }
  const recomputed = assetEvidenceHash(file, a as unknown as HashedAsset);
  if (recomputed !== a.evidence_hash) {
    throw new Error(`${a.asset}: evidence_hash ${a.evidence_hash} does not match the recomputed hash ${recomputed}; the file was edited or is stale`);
  }
}

/**
 * Map one status asset to the contract `Update` (spec 3.1). Throws on `status: null`, a bad hash
 * or time, a status code that disagrees with the status name, or a hash or key that does not recompute.
 */
export function toUpdate(file: FileFields, a: StatusAsset): Update {
  if (a.status === null || a.status_code === null) throw new Error(`${a.asset}: status is null; an unpublished asset is never sent to the feed`);
  if (a.status_code !== STATUS_CODES[a.status]) throw new Error(`${a.asset}: status_code ${a.status_code} does not match status ${a.status}`);
  if (!HEX32.test(a.evidence_hash)) throw new Error(`${a.asset}: evidence_hash is not 64 lowercase hex characters`);
  if (a.checked_at === null) throw new Error(`${a.asset}: checked_at is null`);
  checkIntegrity(file, a);
  const as_of = isoToUnix(a.checked_at, `${a.asset}: checked_at`);
  const issuer_change_seen_at = a.issuer_change_seen_at === null ? 0n : isoToUnix(a.issuer_change_seen_at, `${a.asset}: issuer_change_seen_at`);
  return { asset: a.sac_contract_id, status: a.status_code, flags: a.flags_bitmask, evidence_hash: a.evidence_hash, as_of, issuer_change_seen_at };
}

const hexToBytes = (hex: string) => Uint8Array.from(Buffer.from(hex, "hex"));
const bytesToHex = (b: Uint8Array) => Buffer.from(b).toString("hex");

function assertRange(name: string, v: bigint | number, max: bigint) {
  if (BigInt(v) < 0n || BigInt(v) > max) throw new Error(`${name} is out of range: ${v}`);
}

/**
 * The `Update` struct as a Soroban map. Field names are those of `Update` in the contract; the SDK
 * sorts the map by key, as the host requires. Types are explicit: u32, u64, bytes, address.
 */
export function updateToScVal(u: Update): xdr.ScVal {
  if (!HEX32.test(u.evidence_hash)) throw new Error("evidence_hash must be 64 lowercase hex characters");
  assertRange("status", u.status, BigInt(U32_MAX));
  assertRange("flags", u.flags, BigInt(U32_MAX));
  assertRange("as_of", u.as_of, U64_MAX);
  assertRange("issuer_change_seen_at", u.issuer_change_seen_at, U64_MAX);
  return nativeToScVal(
    { asset: u.asset, status: u.status, flags: u.flags, evidence_hash: hexToBytes(u.evidence_hash), as_of: u.as_of, issuer_change_seen_at: u.issuer_change_seen_at },
    {
      type: {
        asset: ["symbol", "address"],
        status: ["symbol", "u32"],
        flags: ["symbol", "u32"],
        evidence_hash: ["symbol", "bytes"],
        as_of: ["symbol", "u64"],
        issuer_change_seen_at: ["symbol", "u64"],
      },
    },
  );
}

/** `Vec<Update>`, the argument of `publish`. */
export function updatesToScVal(updates: readonly Update[]): xdr.ScVal {
  return nativeToScVal(updates.map(updateToScVal));
}

/** `Vec<Address>`, the argument of `get_many`. */
export function addressesToScVal(keys: readonly string[]): xdr.ScVal {
  return nativeToScVal(keys.map((k) => nativeToScVal(k, { type: "address" })));
}

function u32Field(m: Record<string, unknown>, k: string): number {
  const v = m[k];
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > U32_MAX) throw new Error(`Entry.${k} is not a u32`);
  return v;
}
function u64Field(m: Record<string, unknown>, k: string): bigint {
  const v = m[k];
  if (typeof v !== "bigint" || v < 0n || v > U64_MAX) throw new Error(`Entry.${k} is not a u64`);
  return v;
}

/** `Option<Entry>`: void is `null`; a map is decoded strictly (every field of schema 1 must be present and typed). */
export function decodeOptionEntry(scv: xdr.ScVal): Entry | null {
  if (scv.type === "scvVoid") return null;
  if (scv.type !== "scvMap") throw new Error(`Expected Option<Entry>, got ${scv.type}`);
  const m = scValToNative(scv) as Record<string, unknown>;
  const hash = m.evidence_hash;
  if (!(hash instanceof Uint8Array) || hash.length !== 32) throw new Error("Entry.evidence_hash is not 32 bytes");
  return {
    asset: "",
    version: u32Field(m, "version"),
    status: u32Field(m, "status"),
    flags: u32Field(m, "flags"),
    evidence_hash: bytesToHex(hash),
    as_of: u64Field(m, "as_of"),
    issuer_change_seen_at: u64Field(m, "issuer_change_seen_at"),
    published_ledger: u32Field(m, "published_ledger"),
  };
}

/** `Vec<Option<Entry>>`, the result of `get_many`, in input order. `keys` names each entry. */
export function decodeEntries(scv: xdr.ScVal, keys: readonly string[]): (Entry | null)[] {
  if (scv.type !== "scvVec" || !scv.value) throw new Error(`Expected Vec<Option<Entry>>, got ${scv.type}`);
  if (scv.value.length !== keys.length) throw new Error(`get_many returned ${scv.value.length} entries for ${keys.length} keys`);
  return scv.value.map((item, i) => {
    const e = decodeOptionEntry(item);
    return e ? { ...e, asset: keys[i] } : null;
  });
}

/** An entry written for this `Update` has the same values (everything but `version` and `published_ledger`). */
export function entryMatches(e: Entry, u: Update): string[] {
  const diffs: string[] = [];
  if (e.version !== FEED_SCHEMA) diffs.push(`version ${e.version} != ${FEED_SCHEMA}`);
  if (e.status !== u.status) diffs.push(`status ${e.status} != ${u.status}`);
  if (e.flags !== u.flags) diffs.push(`flags ${e.flags} != ${u.flags}`);
  if (e.evidence_hash !== u.evidence_hash) diffs.push(`evidence_hash ${e.evidence_hash} != ${u.evidence_hash}`);
  if (e.as_of !== u.as_of) diffs.push(`as_of ${e.as_of} != ${u.as_of}`);
  if (e.issuer_change_seen_at !== u.issuer_change_seen_at) diffs.push(`issuer_change_seen_at ${e.issuer_change_seen_at} != ${u.issuer_change_seen_at}`);
  return diffs;
}
