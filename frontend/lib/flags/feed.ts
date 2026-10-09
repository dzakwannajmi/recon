/**
 * Feed fields of a status (D-038, D-039), computed offline from the stored checks.
 * Pure: no network, no clock, no LLM.
 */
import { sacContractId } from "../chain/asset";
import type { UniverseAsset } from "../chain/universe";
import { issuerChangeSeenAt, type ChecksSeries } from "./changes";
import type { AssetContext, FileFields } from "./status";
import { isIsoTime, type ChecksRow } from "./types";

/**
 * The chain read a status rests on: the later of identity.checkedAt and facts.checkedAt of the row.
 * (The identity read is cached per issuer, so it can be older than the facts.) Null for a missing
 * or failed row. This is the feed's `as_of`; a change seen in the facts is never later than it.
 */
export function chainCheckedAt(row: ChecksRow | undefined): string | null {
  if (!row || row.error) return null;
  const times = [row.identity?.checkedAt, row.facts?.checkedAt].filter((t): t is string => isIsoTime(t));
  if (times.length === 0) return null;
  return times.reduce((best, t) => (Date.parse(t) > Date.parse(best) ? t : best));
}

/**
 * The feed key: derived from CODE and issuer with the public passphrase. If data/assets.csv lists a
 * different value, throw: an entry must never be published under a wrong key. An empty CSV value is allowed.
 */
export function resolveSacContractId(asset: Pick<UniverseAsset, "asset_code" | "issuer" | "sac_contract_id">): string {
  const derived = sacContractId(asset.asset_code, asset.issuer);
  const listed = (asset.sac_contract_id ?? "").trim();
  if (listed !== "" && listed !== derived) {
    throw new Error(`data/assets.csv lists sac_contract_id ${listed} for ${asset.asset_code}:${asset.issuer}, but the contract ID derived from the code and issuer is ${derived}`);
  }
  return derived;
}

/** What `assetStatus` needs besides the evaluations, built from the same series the deciders read. */
export function assetContext(asset: UniverseAsset, series: ChecksSeries, file: FileFields): AssetContext {
  return {
    ...file,
    sac_contract_id: resolveSacContractId(asset),
    checked_at: chainCheckedAt(series[series.length - 1]),
    issuer_change_seen_at: issuerChangeSeenAt(series),
  };
}
