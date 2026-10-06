/**
 * On-chain facts about one asset: total supply, trustlines, flags, issuer
 * signers, and the largest holder's share. Read-only (Horizon + StellarExpert).
 *
 * Amounts are handled as BigInt stroops (7 decimals) so sums are exact.
 */
import { Asset, Networks } from "@stellar/stellar-sdk";
import { ttlCache } from "./cache";
import { fetchTrustedJson } from "./http";
import { HORIZON_MAINNET, getAsset, getIssuerAccount, type AssetFlags, type AssetRecord, type IssuerAccount } from "./horizon";

const STELLAR_EXPERT = "https://api.stellar.expert/explorer/public";
const DECIMALS = 7;
const CACHE_TTL_MS = 10 * 60 * 1000;

/** "522773589.6259489" → 5227735896259489n. Missing or malformed → 0n. */
export function toStroops(amount: string | undefined): bigint {
  const match = /^(\d+)(?:\.(\d{1,7}))?$/.exec(amount ?? "");
  if (!match) return 0n;
  return BigInt(match[1]) * 10n ** BigInt(DECIMALS) + BigInt((match[2] ?? "").padEnd(DECIMALS, "0"));
}

/** 5227735896259489n → "522773589.6259489" */
export function formatStroops(stroops: bigint): string {
  const s = stroops.toString().padStart(DECIMALS + 1, "0");
  return `${s.slice(0, -DECIMALS)}.${s.slice(-DECIMALS)}`;
}

export type SupplyBreakdown = {
  authorized: string;
  authorized_to_maintain_liabilities: string;
  unauthorized: string;
  claimable_balances: string;
  liquidity_pools: string;
  contracts: string;
};

/** Total supply = every place Horizon reports the asset held, summed exactly. */
export function totalSupply(record: AssetRecord) {
  const parts = {
    authorized: toStroops(record.balances.authorized),
    authorized_to_maintain_liabilities: toStroops(record.balances.authorized_to_maintain_liabilities),
    unauthorized: toStroops(record.balances.unauthorized),
    claimable_balances: toStroops(record.claimable_balances_amount),
    liquidity_pools: toStroops(record.liquidity_pools_amount),
    contracts: toStroops(record.contracts_amount),
  };
  const total = Object.values(parts).reduce((a, b) => a + b, 0n);
  const breakdown = Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, formatStroops(v)])) as SupplyBreakdown;
  return { total, breakdown };
}

/** The Stellar Asset Contract address on mainnet. Deterministic from code + issuer; it says nothing about whether the SAC is deployed. */
export function sacContractId(code: string, issuer: string) {
  return new Asset(code, issuer).contractId(Networks.PUBLIC);
}

/** Share of `part` in `total` as a percent with 2 decimals (floored). Null when total is 0. */
export function sharePercent(part: bigint, total: bigint): number | null {
  if (total <= 0n) return null;
  return Number((part * 10_000n) / total) / 100;
}

export type AssetFacts = {
  assetCode: string;
  issuer: string;
  exists: boolean;
  /** Total supply in units (7 decimals), summed from Horizon balances. */
  supply?: string;
  supplyBreakdown?: SupplyBreakdown;
  /** Trustlines authorized to hold the asset (Horizon accounts.authorized). Not the same as holders. */
  authorizedTrustlines?: number;
  /** Trustlines with a non-zero balance (StellarExpert), or null if unavailable. */
  fundedHolders?: number | null;
  flags?: AssetFlags;
  issuerSigners?: { key: string; weight: number }[];
  issuerThresholds?: { low: number; medium: number; high: number };
  /** Deterministic SAC address (deployment not checked yet). */
  sacContractId?: string;
  /** Largest single account balance as a share of the total supply above (same base). */
  largestHolder?: { address: string; balance: string; sharePercent: number | null } | null;
  checkedAt: string;
  sources: string[];
};

type ExpertAsset = { trustlines?: { funded?: number } };
type ExpertHolders = { _embedded?: { records?: { address?: string; account?: string; balance?: string }[] } };

/** StellarExpert extras: funded holder count and the largest holder. Null fields if unavailable. */
async function getExpertExtras(code: string, issuer: string) {
  const id = `${encodeURIComponent(code)}-${encodeURIComponent(issuer)}`;
  const assetUrl = `${STELLAR_EXPERT}/asset/${id}`;
  const holdersUrl = `${STELLAR_EXPERT}/asset/${id}/holders?limit=1&order=desc`;
  try {
    const [asset, holders] = await Promise.all([
      fetchTrustedJson<ExpertAsset>(assetUrl),
      fetchTrustedJson<ExpertHolders>(holdersUrl),
    ]);
    const top = holders._embedded?.records?.[0];
    const address = top?.address ?? top?.account;
    const funded = asset.trustlines?.funded;
    return {
      fundedHolders: typeof funded === "number" ? funded : null,
      top: address && top?.balance && /^\d+$/.test(top.balance) ? { address, stroops: BigInt(top.balance) } : null,
      sources: [assetUrl, holdersUrl],
    };
  } catch {
    return { fundedHolders: null, top: null, sources: [] as string[] };
  }
}

/** Everything read from the network for one asset, and when it was read. */
type NetworkInputs = {
  asset: AssetRecord | null;
  account: IssuerAccount | null;
  expert: Awaited<ReturnType<typeof getExpertExtras>> | null;
  fetchedAt: string;
};

const DEGRADED_TTL_MS = 60 * 1000; // StellarExpert extras missing: retry sooner
const cache = ttlCache<NetworkInputs>((v) => (v.asset && v.expert?.sources.length === 0 ? DEGRADED_TTL_MS : CACHE_TTL_MS));

/** Shared by concurrent callers, so it uses only its own deadlines, never a caller's abort signal. */
async function loadNetworkInputs(code: string, issuer: string): Promise<NetworkInputs> {
  const fetchedAt = new Date().toISOString();
  const [asset, account] = await Promise.all([getAsset(code, issuer), getIssuerAccount(issuer)]);
  const expert = asset ? await getExpertExtras(code, issuer) : null;
  return { asset, account, expert, fetchedAt };
}

export async function getAssetFacts(code: string, issuer: string, opts: { signal?: AbortSignal } = {}): Promise<AssetFacts> {
  const { asset, account, expert, fetchedAt: checkedAt } = await cache.get(
    `${code}:${issuer}`,
    () => loadNetworkInputs(code, issuer),
    opts.signal,
  );
  const sources = [
    `${HORIZON_MAINNET}/assets?asset_code=${encodeURIComponent(code)}&asset_issuer=${encodeURIComponent(issuer)}`,
    `${HORIZON_MAINNET}/accounts/${encodeURIComponent(issuer)}`,
  ];
  if (!asset) return { assetCode: code, issuer, exists: false, checkedAt, sources };

  const { total, breakdown } = totalSupply(asset);
  return {
    assetCode: code,
    issuer,
    exists: true,
    supply: formatStroops(total),
    supplyBreakdown: breakdown,
    authorizedTrustlines: asset.accounts.authorized,
    fundedHolders: expert?.fundedHolders ?? null,
    flags: asset.flags,
    issuerSigners: account?.signers.map((s) => ({ key: s.key, weight: s.weight })),
    issuerThresholds: account
      ? { low: account.thresholds.low_threshold, medium: account.thresholds.med_threshold, high: account.thresholds.high_threshold }
      : undefined,
    sacContractId: sacContractId(code, issuer),
    largestHolder: expert?.top
      ? { address: expert.top.address, balance: formatStroops(expert.top.stroops), sharePercent: sharePercent(expert.top.stroops, total) }
      : null,
    checkedAt,
    sources: [...sources, ...(expert?.sources ?? [])],
  };
}

/** For tests only. */
export function clearAssetCache() {
  cache.clear();
}
