/** Small hand-made status objects for the fact sheet tests (so they don't depend on the live data file). */
import type { ClearEvaluation, EvidenceRef } from "../flags/types";
import type { AssetStatus, ReviewedFlag } from "../flags/status";
import type { StatusFile } from "./load";

export const ISSUER = "GBHNGLLIE3KWGKCHIKMHJ5HVZHYIK7WTBE4QF5PLAKL4CJGSEU7HZIW5";
export const HASH = "95d9a389e3797514144c8adaac6b77829e24bac80d15431eafeadf2c60dc8ac7";

export const EV = {
  chain: { kind: "chain_check", ref: `data/checks/2026-10-08.json#AAA:${ISSUER}` } as EvidenceRef,
  chainLink: { kind: "chain_check", ref: `https://horizon.stellar.org/accounts/${ISSUER}`, source_url: `https://horizon.stellar.org/accounts/${ISSUER}` } as EvidenceRef,
  exam: { kind: "examination", ref: `data/examinations/2026-10-08.json#AAA:${ISSUER}#supply_vs_filed_shares` } as EvidenceRef,
  sourceFact: {
    kind: "source_fact", ref: `${HASH}#generalInfo`, source_url: "https://www.sec.gov/Archives/edgar/data/1/primary_doc.xml",
    snapshot_sha256: HASH, quote: "<reportDate>2026-08-31</reportDate>", where: "generalInfo",
  } as EvidenceRef,
  snapshot: { kind: "snapshot", ref: HASH, source_url: "https://www.sec.gov/Archives/edgar/data/1/primary_doc.xml", snapshot_sha256: HASH } as EvidenceRef,
  malformed: { kind: "examination", ref: "data/examinations/2026-10-08.json#only-one" } as EvidenceRef,
};

export function raisedFlag(over: Partial<ReviewedFlag> = {}): ReviewedFlag {
  return {
    flag: "SUPPLY_MISMATCH", outcome: "raised", severity: "WARNING", effective_severity: "WARNING", review: "not_needed",
    review_key: null, document_derived: false, as_of: "2026-10-08", statement: "Mismatch between filing (p.2) and on-chain 5 as of 2026-10-08.",
    evidence: [EV.chain, EV.exam], ...over,
  };
}

export function clearFlag(over: Partial<ClearEvaluation> = {}): ClearEvaluation {
  return { flag: "ISSUER_IDENTITY", outcome: "clear", reason: "Issuer listed in stellar.toml.", as_of: "2026-10-08", evidence: [EV.chain], ...over };
}

export function asset(over: Partial<AssetStatus> = {}): AssetStatus {
  return {
    asset: `AAA:${ISSUER}`, asset_code: "AAA", issuer: ISSUER, issuer_org: "Org One", asset_type: "fund", status: "OK", status_code: 0,
    flags_bitmask: 0, evidence_hash: "ab".repeat(32), raised: [], clear: [clearFlag()],
    not_evaluated: [{ flag: "LARGE_MINT_BURN", outcome: "not_evaluated", reason: "Needs daily issuance data." }], ...over,
  };
}

export function statusFile(assets: AssetStatus[]): StatusFile {
  return {
    generated_at: "2026-10-08T01:48:49.859Z", as_of: "2026-10-08", rules_version: "flags-test",
    inputs: {
      checks: { path: "data/checks/2026-10-08.json", sha256: "a", checked_at: "2026-10-08T01:34:10.993Z" },
      previous_checks: null, examinations: null,
    },
    bits: {}, status_codes: {}, summary: {}, assets,
  };
}
