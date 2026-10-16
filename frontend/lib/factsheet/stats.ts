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
