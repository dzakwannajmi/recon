import { clear, day, examRef, notEvaluated, raised, referenceRef, type Evaluation, type EvidenceRef, type ExamCheck } from "./types";

const SUPPLY_CHECKS = ["supply_vs_filed_shares", "supply_vs_max_issuance"];

/** An excess over the reference above this share is CRITICAL (D-035); a document-derived CRITICAL still needs review. */
export const CRITICAL_EXCESS = 0.25;

/** On-chain excess as a share of the reference (both strings in tokens), or null when it can't be computed. */
export function excessShare(c: Pick<ExamCheck, "difference" | "threshold_tokens">): number | null {
  if (c.difference === null || c.threshold_tokens === null) return null;
  const [diff, ref] = [Number(c.difference), Number(c.threshold_tokens)];
  return Number.isFinite(diff) && Number.isFinite(ref) && ref > 0 ? diff / ref : null;
}

/**
 * SUPPLY_MISMATCH: on-chain supply above what the filing or issuer document
 * allows. WARNING; CRITICAL when the excess is more than 25% of the reference.
 * An excess that can't be computed stays WARNING (never a guessed CRITICAL).
 */
export function flagSupplyMismatch(checks: readonly ExamCheck[]): Evaluation {
  const own = checks.filter((c) => SUPPLY_CHECKS.includes(c.check));
  const mismatches = own.filter((c) => c.status === "mismatch");
  if (mismatches.length > 0) {
    const shares = mismatches.map(excessShare);
    const critical = shares.some((s) => s !== null && s > CRITICAL_EXCESS);
    const evidence: EvidenceRef[] = [];
    for (const c of mismatches) {
      evidence.push(examRef(c));
      if (c.reference) evidence.push(referenceRef(c.reference));
      if (c.ratio) evidence.push(referenceRef(c.ratio));
    }
    const known = shares.filter((s): s is number => s !== null);
    const asOf = mismatches.map((c) => day(c.onchain.as_of)).sort().at(-1)!;
    return raised(
      "SUPPLY_MISMATCH", critical ? "CRITICAL" : "WARNING", mismatches.map((c) => c.statement).join(" "), asOf, evidence,
      known.length > 0 ? { excess_percent: Number((Math.max(...known) * 100).toFixed(2)) } : undefined,
    );
  }
  const consistent = own.filter((c) => c.status === "consistent");
  if (consistent.length > 0) {
    const evidence = consistent.map(examRef);
    return clear("SUPPLY_MISMATCH", consistent.map((c) => c.statement).join(" "), consistent.map((c) => day(c.onchain.as_of)).sort().at(-1)!, evidence);
  }
  const reasons = own.filter((c) => c.status === "not_comparable").map((c) => c.statement);
  return notEvaluated("SUPPLY_MISMATCH", reasons.length > 0 ? reasons.join(" ") : "No filed shares or maximum issuance to compare with");
}
