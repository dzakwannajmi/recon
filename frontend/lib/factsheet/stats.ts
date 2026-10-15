import { loadStatus, type StatusFile } from "./load";

export type LandingStats = { assets: number; issuers: number; feedEntries: number; asOf: string };

/** Counts for the landing page, from the newest status file. Feed entries = assets that have a published status. */
export function statsFrom(status: StatusFile): LandingStats {
  return {
    assets: status.assets.length,
    issuers: new Set(status.assets.map((a) => a.issuer_org)).size,
    feedEntries: status.assets.filter((a) => a.status !== null).length,
    asOf: status.as_of,
  };
}

export const loadLandingStats = (): LandingStats => statsFrom(loadStatus().status);
