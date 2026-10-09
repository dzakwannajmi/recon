/**
 * Status from evaluations (D-035, D-038, D-039). Pure: the same evaluations, reviews and
 * context always give the same status, bitmask, and evidence hash (no run time in it).
 * Only code computes status; a document-derived CRITICAL counts as WARNING
 * until an operator confirms it by review_key.
 */
import { z } from "zod";
import { sha256Hex } from "../documents/store";
import type { UniverseAsset } from "../chain/universe";
import {
  FEED_SCHEMA, FLAG_BITS, FLAG_ORDER, STATUS_CODES,
  type ClearEvaluation, type Evaluation, type FlagName, type NotEvaluated, type RaisedEvaluation, type Severity, type StatusName,
} from "./types";

export { FEED_SCHEMA };

export type ReviewState = "not_needed" | "pending" | "confirmed" | "rejected";

export const reviewSchema = z.array(
  z.object({
    asset: z.string().min(1),
    flag: z.enum(FLAG_ORDER as [FlagName, ...FlagName[]]),
    review_key: z.string().regex(/^[0-9a-f]{64}$/),
    decision: z.enum(["confirm", "reject"]),
    by: z.string().min(1),
    at: z.string().min(1),
    note: z.string().optional(),
  }).strict(),
);
export type Review = z.infer<typeof reviewSchema>[number];

/** Parse data/review/flags.json; a bad entry throws (never a silent confirm). */
export function parseReviews(json: unknown): Review[] {
  const parsed = reviewSchema.safeParse(json);
  if (!parsed.success) throw new Error(`data/review/flags.json is invalid: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return parsed.data;
}

export type ReviewedFlag = RaisedEvaluation & {
  document_derived: boolean;
  review: ReviewState;
  review_key: string | null;
  effective_severity: Severity;
};

export type AssetStatus = {
  asset: string;
  asset_code: string;
  issuer: string;
  issuer_org: string;
  asset_type: string;
  /** The feed key: the mainnet token contract address (SAC) of this asset (D-039). */
  sac_contract_id: string;
  /** null = not published (no chain check). */
  status: StatusName | null;
  status_code: 0 | 1 | 2 | null;
  /**
   * The chain read the status rests on: the later of identity.checkedAt and facts.checkedAt of the
   * current checks row (the identity read is cached per issuer). Null when there is no chain check.
   */
  checked_at: string | null;
  flags_bitmask: number;
  /** checkedAt of the check that first showed the latest issuer flag, signer or threshold change; null if none was seen (D-038). Never cleared by the hold window. */
  issuer_change_seen_at: string | null;
  evidence_hash: string;
  raised: ReviewedFlag[];
  clear: ClearEvaluation[];
  not_evaluated: NotEvaluated[];
};

/** Plain code-unit order, so the same input gives the same bytes on every machine. */
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** JSON with object keys sorted recursively, no whitespace; arrays keep their order; undefined fields are dropped. */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => cmp(a, b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

const isDocumentDerived = (e: RaisedEvaluation) => e.evidence.some((r) => r.kind === "claim" || r.kind === "source_fact");

/**
 * Flags whose CRITICAL needs no operator review: the identity check is chain
 * plus a SEP-1 protocol check (D-035). Any other CRITICAL waits for a confirmation.
 */
export const NO_REVIEW_CRITICAL: ReadonlySet<FlagName> = new Set<FlagName>(["ISSUER_IDENTITY"]);

/**
 * SHA-256 of the asset, the flag, and the documents (snapshot hash and quote)
 * behind it. On-chain values are not in it, so a confirmation lasts until the document changes.
 */
export function reviewKey(asset: string, e: RaisedEvaluation): string {
  const documents = e.evidence
    .filter((r) => r.kind === "claim" || r.kind === "source_fact")
    .map((r) => ({ snapshot_sha256: r.snapshot_sha256 ?? null, quote: r.quote ?? null }))
    .sort((a, b) => cmp(a.snapshot_sha256 ?? "", b.snapshot_sha256 ?? "") || cmp(a.quote ?? "", b.quote ?? ""));
  return sha256Hex(canonicalJson({ asset, flag: e.flag, documents }));
}

function review(asset: string, e: RaisedEvaluation, reviews: readonly Review[]): ReviewedFlag {
  const document_derived = isDocumentDerived(e);
  if (e.severity !== "CRITICAL" || NO_REVIEW_CRITICAL.has(e.flag)) return { ...e, document_derived, review: "not_needed", review_key: null, effective_severity: e.severity };
  // Without a document there is nothing a review key can pin, so it can never be confirmed.
  if (!document_derived) return { ...e, document_derived, review: "pending", review_key: null, effective_severity: "WARNING" };
  const key = reviewKey(asset, e);
  const entries = reviews.filter((r) => r.asset === asset && r.flag === e.flag && r.review_key === key);
  // Conflicting entries resolve to the conservative one: any rejection wins over a confirmation.
  if (entries.length > 0 && entries.every((r) => r.decision === "confirm")) return { ...e, document_derived, review: "confirmed", review_key: key, effective_severity: "CRITICAL" };
  return { ...e, document_derived, review: entries.length > 0 ? "rejected" : "pending", review_key: key, effective_severity: "WARNING" };
}

const byBit = <T extends { flag: FlagName }>(list: T[]) => [...list].sort((a, b) => FLAG_BITS[a.flag] - FLAG_BITS[b.flag]);

/** Exactly one evaluation per flag: a missing or duplicate one must stop the run, never publish a status. */
function assertOnePerFlag(key: string, evaluations: readonly Evaluation[]) {
  const seen = evaluations.map((e) => e.flag);
  const ok = seen.length === FLAG_ORDER.length && FLAG_ORDER.every((f) => seen.filter((x) => x === f).length === 1);
  if (!ok) throw new Error(`${key}: expected exactly one evaluation for each of ${FLAG_ORDER.length} flags, got ${seen.length} (${seen.join(", ") || "none"})`);
}

/** The status-file fields that are hashed with every asset (spec 3.4). `generated_at` (run time) is not one of them. */
export type FileFields = { feed_schema: number; rules_version: string; inputs: unknown };

/** What the status script knows about one asset besides its evaluations. */
export type AssetContext = FileFields & {
  sac_contract_id: string;
  checked_at: string | null;
  issuer_change_seen_at: string | null;
};

export type HashedAsset = Pick<
  AssetStatus,
  "asset" | "sac_contract_id" | "checked_at" | "status" | "flags_bitmask" | "issuer_change_seen_at" | "raised" | "clear" | "not_evaluated"
>;

/**
 * The one evidence_hash implementation (spec 3.4): SHA-256 of the canonical JSON of the file
 * fields and the asset's conclusion. The W3.2 publisher and verifier call this same function.
 */
export function assetEvidenceHash(file: FileFields, a: HashedAsset): string {
  return sha256Hex(canonicalJson({
    feed_schema: file.feed_schema,
    rules_version: file.rules_version,
    asset: a.asset,
    sac_contract_id: a.sac_contract_id,
    checked_at: a.checked_at,
    status: a.status,
    flags_bitmask: a.flags_bitmask,
    issuer_change_seen_at: a.issuer_change_seen_at,
    raised: a.raised,
    clear: a.clear,
    not_evaluated: a.not_evaluated,
    inputs: file.inputs,
  }));
}

/** Bits 3 and 4 (FLAG_CHANGE, SIGNER_CHANGE): the contract needs a change time with them. */
const CHANGE_MASK = (1 << FLAG_BITS.FLAG_CHANGE) | (1 << FLAG_BITS.SIGNER_CHANGE);

/** One asset's status from its nine evaluations (exactly one per flag). */
export function assetStatus(asset: UniverseAsset, evaluations: readonly Evaluation[], reviews: readonly Review[], ctx: AssetContext): AssetStatus {
  const key = `${asset.asset_code}:${asset.issuer}`;
  assertOnePerFlag(key, evaluations);
  const raisedList = byBit(evaluations.filter((e): e is RaisedEvaluation => e.outcome === "raised").map((e) => review(key, e, reviews)));
  const clearList = byBit(evaluations.filter((e): e is ClearEvaluation => e.outcome === "clear"));
  const notEvaluatedList = byBit(evaluations.filter((e): e is NotEvaluated => e.outcome === "not_evaluated"));
  const published = evaluations.some((e) => e.flag === "ISSUER_IDENTITY" && e.outcome !== "not_evaluated");
  const status: StatusName | null = !published
    ? null
    : raisedList.some((r) => r.effective_severity === "CRITICAL") ? "CRITICAL" : raisedList.length > 0 ? "WARNING" : "OK";
  // Nothing is published for an unpublished asset, so no bits either (its raised flags stay listed).
  const flags_bitmask = !status ? 0 : raisedList.reduce((mask, r) => mask | (1 << FLAG_BITS[r.flag]), 0);
  // Invariants the feed contract also checks: stop the run here instead of writing a file that can't be published.
  if (status) {
    if (!ctx.checked_at) throw new Error(`${key}: a published status needs checked_at`);
    if ((flags_bitmask & CHANGE_MASK) !== 0 && !ctx.issuer_change_seen_at) throw new Error(`${key}: FLAG_CHANGE or SIGNER_CHANGE is raised but issuer_change_seen_at is null`);
    if (ctx.issuer_change_seen_at && Date.parse(ctx.issuer_change_seen_at) > Date.parse(ctx.checked_at)) {
      throw new Error(`${key}: issuer_change_seen_at ${ctx.issuer_change_seen_at} is later than checked_at ${ctx.checked_at}`);
    }
  }
  const body: HashedAsset = {
    asset: key, sac_contract_id: ctx.sac_contract_id, checked_at: ctx.checked_at, status, flags_bitmask,
    issuer_change_seen_at: ctx.issuer_change_seen_at, raised: raisedList, clear: clearList, not_evaluated: notEvaluatedList,
  };
  return {
    asset: key, asset_code: asset.asset_code, issuer: asset.issuer, issuer_org: asset.issuer_org, asset_type: asset.asset_type,
    sac_contract_id: ctx.sac_contract_id, status, status_code: status ? STATUS_CODES[status] : null,
    checked_at: ctx.checked_at, flags_bitmask, issuer_change_seen_at: ctx.issuer_change_seen_at, evidence_hash: assetEvidenceHash(ctx, body),
    raised: raisedList, clear: clearList, not_evaluated: notEvaluatedList,
  };
}
