/**
 * The free summary body (`check-summary/1`, spec 2.3). A pure projection of the stored status file:
 * it relays what `npm run status` stored, byte for byte, and computes no status or flag (golden rule 1).
 * It never carries an amount: the facts stay free (golden rule 7).
 */
import type { UniverseAsset } from "../chain/universe";
import type { LoadedAsset, StatusFile } from "../factsheet/load";
import { factSheetPath } from "../agent-data/assets";
import { NOTICE, NO_CHECK_NOTE, SCOPE_NOTE } from "./copy";

export const SUMMARY_SCHEMA = "check-summary/1";
export const FEED_NETWORK = "stellar:testnet";

export type FeedInfo = { contract_id: string };

export type SummaryInput = {
  asset: LoadedAsset;
  row: UniverseAsset | null;
  codeIsUnique: boolean;
  /** The status file and its name, e.g. `2026-10-09.json`. */
  status: { file: string; status: StatusFile };
  /** The testnet feed deployment, or null when its record cannot be read. */
  deployment: FeedInfo | null;
  /** `paymentConfig(env).ok`: whether the paid detail is switched on and configured. */
  paidAvailable: boolean;
};

export function buildSummary({ asset, row, codeIsUnique, status, deployment, paidAvailable }: SummaryInput) {
  const detailQuery = `asset_code=${encodeURIComponent(asset.asset_code)}&issuer=${encodeURIComponent(asset.issuer)}`;
  const published = asset.status !== null;
  return {
    schema: SUMMARY_SCHEMA,
    asset: {
      code: asset.asset_code,
      issuer: asset.issuer,
      issuer_org: asset.issuer_org,
      type: asset.asset_type,
      official_domain: row?.official_domain || null,
      sac_contract_id: asset.sac_contract_id ?? null,
    },
    status: asset.status,
    as_of: status.status.as_of,
    checked_at: asset.checked_at ?? null,
    issuer_change_seen_at: asset.issuer_change_seen_at ?? null,
    rules_version: status.status.rules_version,
    raised_flags: asset.raised.map((f) => ({
      code: f.flag,
      severity: f.effective_severity ?? f.severity,
      statement: f.statement,
      as_of: f.as_of,
    })),
    counts: { raised: asset.raised.length, clear: asset.clear.length, not_evaluated: asset.not_evaluated.length },
    feed:
      published && deployment && asset.sac_contract_id
        ? { network: FEED_NETWORK, contract_id: deployment.contract_id, key: asset.sac_contract_id, evidence_hash: asset.evidence_hash }
        : null,
    fact_sheet: codeIsUnique ? factSheetPath(asset.asset_code) : null,
    paid_detail: { path: `/api/check/detail?${detailQuery}`, protocol: "x402", network: FEED_NETWORK, available: paidAvailable },
    scope: SCOPE_NOTE,
    notice: NOTICE,
    source_file: `data/status/${status.file}`,
    ...(published ? {} : { note: NO_CHECK_NOTE }),
  };
}
