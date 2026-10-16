import { loadStatus, type StatusFile } from "./load";

export type LandingStats = { assets: number; issuers: number };

/** Counts for the landing hero pill, from the newest status file. */
export function statsFrom(status: StatusFile): LandingStats {
  return {
    assets: status.assets.length,
    issuers: new Set(status.assets.map((a) => a.issuer_org)).size,
  };
}

export const loadLandingStats = (): LandingStats => statsFrom(loadStatus().status);

export type IssuerGroup = { issuer: string; assets: { code: string; type: string }[] };

/** Assets grouped by issuer organisation, in the order they first appear in the status file. */
export function groupByIssuer(status: StatusFile): IssuerGroup[] {
  const groups = new Map<string, IssuerGroup>();
  for (const a of status.assets) {
    const g = groups.get(a.issuer_org) ?? { issuer: a.issuer_org, assets: [] };
    g.assets.push({ code: a.asset_code, type: a.asset_type });
    groups.set(a.issuer_org, g);
  }
  return [...groups.values()];
}
