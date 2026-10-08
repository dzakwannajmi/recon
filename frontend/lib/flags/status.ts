/**
 * Status from evaluations (D-035). Pure: the same evaluations and reviews
 * always give the same status, bitmask, and evidence hash (no run time in it).
 * Only code computes status; a document-derived CRITICAL counts as WARNING
 * until an operator confirms it by review_key.
 */
import { z } from "zod";
import { sha256Hex } from "../documents/store";
import type { UniverseAsset } from "../chain/universe";
import {
  FLAG_BITS, FLAG_ORDER, STATUS_CODES,
  type ClearEvaluation, type Evaluation, type FlagName, type NotEvaluated, type RaisedEvaluation, type Severity, type StatusName,
} from "./types";

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
  /** null = not published (no chain check). */
  status: StatusName | null;
  status_code: 0 | 1 | 2 | null;
  flags_bitmask: number;
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
  if (e.severity !== "CRITICAL" || !document_derived) return { ...e, document_derived, review: "not_needed", review_key: null, effective_severity: e.severity };
  const key = reviewKey(asset, e);
  const entries = reviews.filter((r) => r.asset === asset && r.flag === e.flag && r.review_key === key);
  // Conflicting entries resolve to the conservative one: any rejection wins over a confirmation.
  if (entries.length > 0 && entries.every((r) => r.decision === "confirm")) return { ...e, document_derived, review: "confirmed", review_key: key, effective_severity: "CRITICAL" };
  return { ...e, document_derived, review: entries.length > 0 ? "rejected" : "pending", review_key: key, effective_severity: "WARNING" };
}

const byBit = <T extends { flag: FlagName }>(list: T[]) => [...list].sort((a, b) => FLAG_BITS[a.flag] - FLAG_BITS[b.flag]);

/** One asset's status from its nine evaluations (exactly one per flag). */
export function assetStatus(asset: UniverseAsset, evaluations: readonly Evaluation[], reviews: readonly Review[]): AssetStatus {
  const key = `${asset.asset_code}:${asset.issuer}`;
  const raisedList = byBit(evaluations.filter((e): e is RaisedEvaluation => e.outcome === "raised").map((e) => review(key, e, reviews)));
  const clearList = byBit(evaluations.filter((e): e is ClearEvaluation => e.outcome === "clear"));
  const notEvaluatedList = byBit(evaluations.filter((e): e is NotEvaluated => e.outcome === "not_evaluated"));
  const published = !evaluations.some((e) => e.flag === "ISSUER_IDENTITY" && e.outcome === "not_evaluated");
  const status: StatusName | null = !published
    ? null
    : raisedList.some((r) => r.effective_severity === "CRITICAL") ? "CRITICAL" : raisedList.length > 0 ? "WARNING" : "OK";
  const flags_bitmask = raisedList.reduce((mask, r) => mask | (1 << FLAG_BITS[r.flag]), 0);
  const evidence_hash = sha256Hex(canonicalJson({ asset: key, status, flags_bitmask, raised: raisedList, clear: clearList, not_evaluated: notEvaluatedList }));
  return {
    asset: key, asset_code: asset.asset_code, issuer: asset.issuer, issuer_org: asset.issuer_org, asset_type: asset.asset_type,
    status, status_code: status ? STATUS_CODES[status] : null, flags_bitmask, evidence_hash,
    raised: raisedList, clear: clearList, not_evaluated: notEvaluatedList,
  };
}
