import type { Claim } from "../claims/store";
import type { UniverseAsset } from "../chain/universe";
import { currentRecords, type SnapshotRecord } from "../documents/store";
import type { CheckResult } from "../examine/checks";
import type { StoredSourceFact } from "../examine/sources";
import { flagFlagChange, flagSignerChange } from "./changes";
import { flagNoPublicDocs } from "./docs";
import { flagIssuerIdentity } from "./identity";
import { examChecksFor, reportDatesFor, rowFor } from "./inputs";
import { flagLargeMintBurn, flagPriceDeviation } from "./monitor";
import { flagStaleAttestation } from "./stale";
import { flagSupplyMismatch } from "./supply";
import { flagTomlInconsistent } from "./toml";
import type { ChecksRow, Evaluation } from "./types";

/** The stored run files one run reads. */
export type RunInputs = {
  asOf: string;
  checks: readonly ChecksRow[];
  /** Null when there is no older checks file. */
  previousChecks: readonly ChecksRow[] | null;
  examinations: { file: string; checks: readonly CheckResult[] } | null;
  claims: readonly Claim[];
  sources: readonly StoredSourceFact[];
  snapshots: readonly SnapshotRecord[];
};

/** All nine evaluations for one asset, in feed bit order. Monitor flags get no input in v1. */
export function evaluateAsset(asset: UniverseAsset, run: RunInputs): Evaluation[] {
  const key = `${asset.asset_code}:${asset.issuer}`;
  const row = rowFor(run.checks, asset.asset_code, asset.issuer);
  const previous = run.previousChecks ? rowFor(run.previousChecks, asset.asset_code, asset.issuer) : undefined;
  const exam = run.examinations ? examChecksFor(run.examinations.checks, key, run.examinations.file) : [];
  return [
    flagIssuerIdentity(row),
    flagSupplyMismatch(exam),
    flagStaleAttestation({ assetType: asset.asset_type, reports: reportDatesFor(key, run.sources, run.claims, run.snapshots), asOf: run.asOf }),
    flagFlagChange(previous, row),
    flagSignerChange(previous, row),
    flagLargeMintBurn(null),
    flagPriceDeviation(null),
    flagNoPublicDocs(currentRecords(run.snapshots), key),
    flagTomlInconsistent(row, exam),
  ];
}
