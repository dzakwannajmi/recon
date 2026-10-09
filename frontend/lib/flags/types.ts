/**
 * Flag rules (decisions D-035, D-038): shared types. Every flag ends as `raised`,
 * `clear`, or `not_evaluated`; missing inputs are never guessed. Deciders are
 * pure functions over the stored run files (no network, no LLM).
 */
import type { AssetFacts } from "../chain/asset";
import type { IdentityCheck } from "../chain/identity";
import type { CheckResult, Reference } from "../examine/checks";

export type FlagName =
  | "ISSUER_IDENTITY" | "SUPPLY_MISMATCH" | "STALE_ATTESTATION" | "FLAG_CHANGE" | "SIGNER_CHANGE"
  | "LARGE_MINT_BURN" | "PRICE_DEVIATION" | "NO_PUBLIC_DOCS" | "TOML_INCONSISTENT";

/** Feed bit positions. Append-only (D-035): never renumber. */
export const FLAG_BITS = {
  ISSUER_IDENTITY: 0, SUPPLY_MISMATCH: 1, STALE_ATTESTATION: 2, FLAG_CHANGE: 3, SIGNER_CHANGE: 4,
  LARGE_MINT_BURN: 5, PRICE_DEVIATION: 6, NO_PUBLIC_DOCS: 7, TOML_INCONSISTENT: 8,
} as const satisfies Record<FlagName, number>;

export const STATUS_CODES = { OK: 0, WARNING: 1, CRITICAL: 2 } as const;
export type StatusName = keyof typeof STATUS_CODES;

export const RULES_VERSION = "flags-v2";

/** Layout of the feed entry and of its evidence hash (D-039). Bump together with the contract's SCHEMA. */
export const FEED_SCHEMA = 1;

/** Flags in feed bit order. */
export const FLAG_ORDER = (Object.keys(FLAG_BITS) as FlagName[]).sort((a, b) => FLAG_BITS[a] - FLAG_BITS[b]);

export type EvidenceRef = {
  kind: "chain_check" | "examination" | "claim" | "source_fact" | "snapshot";
  /** e.g. "data/checks/2026-10-08.json#BB1:GD5J…", a claim id, or a snapshot sha256. */
  ref: string;
  source_url?: string | null;
  snapshot_sha256?: string | null;
  quote?: string | null;
  /** Page or section. */
  where?: string | null;
};

export type Severity = "WARNING" | "CRITICAL";

export type RaisedEvaluation = {
  flag: FlagName;
  outcome: "raised";
  severity: Severity;
  statement: string;
  as_of: string;
  evidence: EvidenceRef[];
  extra?: Record<string, unknown>;
};
export type ClearEvaluation = { flag: FlagName; outcome: "clear"; reason: string; as_of: string; evidence: EvidenceRef[] };
export type NotEvaluated = { flag: FlagName; outcome: "not_evaluated"; reason: string };
export type Evaluation = RaisedEvaluation | ClearEvaluation | NotEvaluated;

/** One result of data/checks/YYYY-MM-DD.json, with the file it came from. */
export type ChecksRow = {
  asset_code: string;
  issuer: string;
  issuer_org: string;
  identity?: IdentityCheck;
  facts?: AssetFacts;
  error?: string;
  /** Repo-relative path of the checks file, e.g. "data/checks/2026-10-08.json". */
  file: string;
};

/** An examination check with the file it came from. */
export type ExamCheck = CheckResult & { file: string };

export const day = (iso: string) => iso.slice(0, 10);

/** A real calendar date in the form YYYY-MM-DD (rejects 2026-02-30). */
export function isIsoDay(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** A full ISO time in the canonical form `YYYY-MM-DDTHH:mm:ss.sssZ` (what `toISOString` writes); anything looser is rejected. */
export function isIsoTime(t: unknown): t is string {
  return typeof t === "string" && Number.isFinite(Date.parse(t)) && new Date(t).toISOString() === t;
}

export const raised = (
  flag: FlagName, severity: Severity, statement: string, as_of: string, evidence: EvidenceRef[], extra?: Record<string, unknown>,
): RaisedEvaluation => ({ flag, outcome: "raised", severity, statement, as_of, evidence, ...(extra ? { extra } : {}) });
export const clear = (flag: FlagName, reason: string, as_of: string, evidence: EvidenceRef[]): ClearEvaluation => ({ flag, outcome: "clear", reason, as_of, evidence });
export const notEvaluated = (flag: FlagName, reason: string): NotEvaluated => ({ flag, outcome: "not_evaluated", reason });

/** Reference to one row of a checks file. */
export const chainRef = (row: ChecksRow): EvidenceRef => ({ kind: "chain_check", ref: `${row.file}#${row.asset_code}:${row.issuer}` });

/** An examination check as evidence. */
export const examRef = (c: ExamCheck): EvidenceRef => ({ kind: "examination", ref: `${c.file}#${c.asset}#${c.check}` });

/** A check's reference (filing, toml, or issuer-document claim) as evidence, with its quote and snapshot. */
export function referenceRef(r: Reference): EvidenceRef {
  return {
    kind: r.kind === "claim" ? "claim" : "source_fact",
    ref: `${r.snapshot_sha256}${r.where ? `#${r.where}` : ""}`,
    source_url: r.source_url,
    snapshot_sha256: r.snapshot_sha256,
    quote: r.quote,
    where: r.where,
  };
}
