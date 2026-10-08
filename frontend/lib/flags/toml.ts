import { chainRef, clear, day, examRef, notEvaluated, raised, referenceRef, type ChecksRow, type Evaluation, type EvidenceRef, type ExamCheck } from "./types";

const TOML_CHECKS = ["supply_vs_toml_fixed_number", "supply_vs_toml_max_number"];

/**
 * TOML_INCONSISTENT (WARNING only): the issuer's own stellar.toml contradicts
 * itself or the chain. Raised when its supply fields disagree with on-chain
 * supply, or when the toml lists the issuer but not this asset code.
 */
export function flagTomlInconsistent(row: ChecksRow | undefined, checks: readonly ExamCheck[]): Evaluation {
  if (!row || row.error || !row.identity) return notEvaluated("TOML_INCONSISTENT", "No chain check for this asset, so the stellar.toml was not read");
  const { identity } = row;
  if (identity.status !== "verified") {
    return notEvaluated("TOML_INCONSISTENT", `The issuer's stellar.toml is not verified for this asset (identity status: ${identity.status})`);
  }
  const asOf = day(identity.checkedAt);
  const mismatches = checks.filter((c) => TOML_CHECKS.includes(c.check) && c.status === "mismatch");
  const statements = mismatches.map((c) => c.statement);
  const evidence: EvidenceRef[] = [chainRef(row)];
  for (const c of mismatches) {
    evidence.push(examRef(c));
    if (c.reference) evidence.push(referenceRef(c.reference));
  }
  if (identity.codeListed === false) {
    statements.push(`The stellar.toml at ${identity.homeDomain} lists the issuer account but no [[CURRENCIES]] entry for ${identity.assetCode} (as of ${asOf}).`);
  }
  if (statements.length > 0) return raised("TOML_INCONSISTENT", "WARNING", statements.join(" "), asOf, evidence);
  if (identity.codeListed === true) {
    return clear("TOML_INCONSISTENT", `The stellar.toml lists ${identity.assetCode} and no toml supply field differs from on-chain supply (as of ${asOf}).`, asOf, evidence);
  }
  return notEvaluated("TOML_INCONSISTENT", "It is unknown whether the stellar.toml lists this asset code");
}
