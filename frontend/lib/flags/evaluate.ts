import type { Claim } from "../claims/store";
import type { UniverseAsset } from "../chain/universe";
import { currentRecords, type SnapshotRecord } from "../documents/store";
import type { CheckResult } from "../examine/checks";
import type { StoredSourceFact } from "../examine/sources";
import { flagFlagChange, flagSignerChange, type ChecksSeries } from "./changes";
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
  /** The current checks file: the newest dated on or before as-of. */
  checks: readonly ChecksRow[];
  /** Every earlier checks file dated on or before as-of, oldest first (empty when there is none). */
  earlierChecks: readonly (readonly ChecksRow[])[];
  examinations: { file: string; checks: readonly CheckResult[] } | null;
  claims: readonly Claim[];
  sources: readonly StoredSourceFact[];
  snapshots: readonly SnapshotRecord[];
};

/** One asset's rows over every checks file, oldest first, the current file's row last (undefined when it is missing there). */
export function seriesFor(asset: UniverseAsset, run: RunInputs): ChecksSeries {
  return [...run.earlierChecks, run.checks].map((rows) => rowFor(rows, asset.asset_code, asset.issuer));
}

/** All nine evaluations for one asset, in feed bit order. Monitor flags get no input in v1. */
export function evaluateAsset(asset: UniverseAsset, run: RunInputs): Evaluation[] {
  const key = `${asset.asset_code}:${asset.issuer}`;
  const series = seriesFor(asset, run);
  const row = series[series.length - 1];
  const exam = run.examinations ? examChecksFor(run.examinations.checks, key, run.examinations.file) : [];
  return [
    flagIssuerIdentity(row),
    flagSupplyMismatch(exam),
    flagStaleAttestation({ assetType: asset.asset_type, reports: reportDatesFor(key, run.sources, run.claims, run.snapshots), asOf: run.asOf }),
    flagFlagChange(series),
    flagSignerChange(series),
    flagLargeMintBurn(null),
    flagPriceDeviation(null),
    flagNoPublicDocs(currentRecords(run.snapshots), key),
    flagTomlInconsistent(row, exam),
  ];
}
