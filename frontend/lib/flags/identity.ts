import { IDENTITY_SEVERITY } from "../chain/identity";
import { chainRef, clear, day, notEvaluated, raised, type ChecksRow, type Evaluation, type EvidenceRef } from "./types";

/** ISSUER_IDENTITY: the stored decideIdentity result (D-026); severity from its status, never recomputed here. */
export function flagIssuerIdentity(row: ChecksRow | undefined): Evaluation {
  if (!row) return notEvaluated("ISSUER_IDENTITY", "No chain check for this asset in the checks file");
  if (row.error || !row.identity) return notEvaluated("ISSUER_IDENTITY", `The chain check failed: ${row.error ?? "no identity result"}`);
  const { identity } = row;
  const asOf = day(identity.checkedAt);
  const evidence: EvidenceRef[] = [chainRef(row), ...identity.sources.map((url): EvidenceRef => ({ kind: "chain_check", ref: url, source_url: url }))];
  if (identity.status === "verified") return clear("ISSUER_IDENTITY", identity.reason, asOf, evidence);
  // An unknown status has no severity: WARNING, never a guessed CRITICAL.
  return raised("ISSUER_IDENTITY", IDENTITY_SEVERITY[identity.status] ?? "WARNING", identity.reason, asOf, evidence);
}
