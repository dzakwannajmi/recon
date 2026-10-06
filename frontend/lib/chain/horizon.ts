/**
 * Read-only Stellar mainnet data from Horizon. Nothing here signs or submits.
 */
import { FetchError, fetchTrustedJson } from "./http";

export const HORIZON_MAINNET = "https://horizon.stellar.org";
const MAX_ISSUER_PAGES = 5;

export type AssetFlags = {
  auth_required: boolean;
  auth_revocable: boolean;
  auth_immutable: boolean;
  auth_clawback_enabled: boolean;
};

export type IssuerAccount = {
  id: string;
  home_domain?: string;
  flags: AssetFlags;
  signers: { key: string; weight: number; type: string }[];
  thresholds: { low_threshold: number; med_threshold: number; high_threshold: number };
};

export type AssetRecord = {
  asset_code: string;
  asset_issuer: string;
  accounts: { authorized: number; authorized_to_maintain_liabilities?: number; unauthorized?: number };
  balances: { authorized: string; authorized_to_maintain_liabilities?: string; unauthorized?: string };
  claimable_balances_amount?: string;
  liquidity_pools_amount?: string;
  contracts_amount?: string;
  flags: AssetFlags;
};

function isHorizonUrl(href: string) {
  try {
    return new URL(href).origin === HORIZON_MAINNET;
  } catch {
    return false;
  }
}

type Page = { _embedded: { records: AssetRecord[] }; _links?: { next?: { href: string } } };

/** The issuer account, or null if it doesn't exist on mainnet. */
export async function getIssuerAccount(issuer: string, signal?: AbortSignal): Promise<IssuerAccount | null> {
  try {
    return await fetchTrustedJson<IssuerAccount>(`${HORIZON_MAINNET}/accounts/${encodeURIComponent(issuer)}`, { signal });
  } catch (err) {
    if (err instanceof FetchError && err.message === "Not found.") return null;
    throw err;
  }
}

/** One asset (code + issuer), or null if it doesn't exist. */
export async function getAsset(code: string, issuer: string, signal?: AbortSignal): Promise<AssetRecord | null> {
  const url = `${HORIZON_MAINNET}/assets?asset_code=${encodeURIComponent(code)}&asset_issuer=${encodeURIComponent(issuer)}&limit=1`;
  const data = await fetchTrustedJson<Page>(url, { signal });
  return data._embedded.records[0] ?? null;
}

/** Issuers of an asset code, most authorized trustlines first. Reads up to 5 pages of 200. */
export async function listIssuers(code: string, signal?: AbortSignal) {
  const records: AssetRecord[] = [];
  let url: string | undefined = `${HORIZON_MAINNET}/assets?asset_code=${encodeURIComponent(code)}&limit=200`;
  let pages = 0;
  while (url && pages < MAX_ISSUER_PAGES) {
    const page: Page = await fetchTrustedJson<Page>(url, { signal });
    records.push(...page._embedded.records);
    pages++;
    const next = page._links?.next?.href;
    url = page._embedded.records.length === 200 && next && isHorizonUrl(next) ? next : undefined;
  }
  return {
    records: records.sort((a, b) => b.accounts.authorized - a.accounts.authorized),
    truncated: url !== undefined,
  };
}
