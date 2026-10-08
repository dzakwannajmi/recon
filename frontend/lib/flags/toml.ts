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
  const identityDate = day(identity.checkedAt);
  const tomlChecks = checks.filter((c) => TOML_CHECKS.includes(c.check));
  const mismatches = tomlChecks.filter((c) => c.status === "mismatch");
  const statements = mismatches.map((c) => c.statement);
  const evidence: EvidenceRef[] = [chainRef(row)];
  for (const c of mismatches) {
    evidence.push(examRef(c));
    if (c.reference) evidence.push(referenceRef(c.reference));
  }
  if (identity.codeListed === false) {
    statements.push(`The stellar.toml at ${identity.homeDomain} lists the issuer account but no [[CURRENCIES]] entry for ${identity.assetCode} (as of ${identityDate}).`);
  }
  // as_of is the date of the data each reason read: the examination for supply fields, the chain check for the listing.
  const latest = (dates: string[]) => dates.sort().at(-1)!;
  if (statements.length > 0) {
    const dates = [...mismatches.map((c) => day(c.onchain.as_of)), ...(identity.codeListed === false ? [identityDate] : [])];
    return raised("TOML_INCONSISTENT", "WARNING", statements.join(" "), latest(dates), evidence);
  }
  if (identity.codeListed === true) {
    const consistent = tomlChecks.filter((c) => c.status === "consistent");
    const examDates = consistent.map((c) => day(c.onchain.as_of));
    evidence.push(...consistent.map(examRef));
    const supplyNote = examDates.length > 0 ? `; on-chain supply agrees with its toml supply fields (as of ${latest([...examDates])})` : "";
    return clear(
      "TOML_INCONSISTENT", `The stellar.toml lists ${identity.assetCode} (as of ${identityDate}) and no toml supply field differs from on-chain supply${supplyNote}.`,
      latest([identityDate, ...examDates]), evidence,
    );
  }
  return notEvaluated("TOML_INCONSISTENT", "It is unknown whether the stellar.toml lists this asset code");
}
