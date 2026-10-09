/**
 * Read-only views of the stored status file and the asset universe for the chat tools.
 * Pure projections: nothing here computes a status or a flag, it relays what
 * `npm run status` stored (golden rule 1). Each output picks a fixed set of fields,
 * so new optional fields in the status file never leak into tool results.
 */
import type { UniverseAsset } from "../chain/universe";
import type { StatusFile } from "../factsheet/load";

export const SCOPE_NOTE =
  "Non-stablecoin real-world assets (RWAs) on Stellar mainnet. Stablecoins (USDC, EURC, PYUSD, ...) are out of scope.";
export const MAX_STATUS_MATCHES = 5;

/** Fact sheet route: app/[lang]/assets/[code]. */
export const factSheetPath = (code: string) => `/en/assets/${encodeURIComponent(code)}`;

type StatusAsset = StatusFile["assets"][number];

const keyOf = (code: string, issuer: string) => `${code}:${issuer}`;

export function projectAssetList(universe: UniverseAsset[], status: StatusFile | null) {
  const byKey = new Map<string, StatusAsset>();
  for (const a of status?.assets ?? []) byKey.set(keyOf(a.asset_code, a.issuer), a);
  return {
    scope: SCOPE_NOTE,
    status_as_of: status?.as_of ?? null,
    count: universe.length,
    assets: universe.map((u) => ({
      code: u.asset_code,
      issuer: u.issuer,
      org: u.issuer_org || null,
      type: u.asset_type || null,
      home_domain: u.home_domain || null,
      status: byKey.get(keyOf(u.asset_code, u.issuer))?.status ?? null,
    })),
    ...(status ? {} : { note: "No stored status file was found, so no statuses are shown." }),
  };
}

/** Raised flags and counts for the assets with this code (and issuer, if given). Never computes anything. */
export function projectAssetStatus(status: StatusFile, code: string, issuer?: string) {
  const sameCode = status.assets.filter((a) => a.asset_code === code);
  const hits = sameCode.filter((a) => !issuer || a.issuer === issuer);
  if (hits.length === 0) {
    const lookalikes = [...new Set(status.assets.filter((a) => a.asset_code.toLowerCase() === code.toLowerCase()).map((a) => a.asset_code))];
    const parts = [
      issuer && sameCode.length > 0
        ? `${code} is in the stored status file, but not for that issuer.`
        : `${code} is not in the stored status file (as of ${status.as_of}).`,
      lookalikes.length > 0 && sameCode.length === 0 ? `Asset codes are case-sensitive; did you mean ${lookalikes.join(" or ")}?` : "",
      "Use check_asset for a live read of the chain.",
    ];
    return { found: false as const, note: parts.filter(Boolean).join(" ") };
  }
  // The fact sheet page exists only for a code that is unique in the status file.
  const hasPage = sameCode.length === 1;
  return {
    found: true as const,
    assets: hits.slice(0, MAX_STATUS_MATCHES).map((a) => ({
      code: a.asset_code,
      issuer: a.issuer,
      status: a.status,
      as_of: status.as_of,
      rules_version: status.rules_version,
      raised_flags: a.raised.map((f) => ({
        code: f.flag,
        severity: f.effective_severity ?? f.severity,
        statement: f.statement,
        as_of: f.as_of,
      })),
      not_evaluated_count: a.not_evaluated.length,
      fact_sheet: hasPage ? factSheetPath(a.asset_code) : null,
    })),
    ...(hits.length > MAX_STATUS_MATCHES ? { note: `Showing ${MAX_STATUS_MATCHES} of ${hits.length} matches; pass an issuer to narrow.` } : {}),
  };
}
