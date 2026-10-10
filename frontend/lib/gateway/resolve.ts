/**
 * Which stored asset a check request is about (spec 2.1). Pure: no I/O, no clock, no network.
 * Shared by the free summary, the paid detail, and later the MCP tools.
 */
import { StrKey } from "@stellar/stellar-sdk";
import type { UniverseAsset } from "../chain/universe";
import type { LoadedAsset } from "../factsheet/load";
import { SCOPE_NOTE } from "./copy";

export const MAX_PARAM_CHARS = 64;
export const ASSET_CODE_PATTERN = /^[A-Za-z0-9]{1,12}$/;
export const ISSUER_PATTERN = /^G[A-Z2-7]{55}$/;
const ALLOWED_PARAMS = new Set(["asset_code", "issuer"]);

/** Stablecoins are out of scope (golden rule 5). Exact case, as the codes appear on chain. */
export const OUT_OF_SCOPE_STABLECOINS: readonly string[] = ["USDC", "EURC", "PYUSD", "USDGLO", "CETES", "MEXe"];

export type Query = { asset_code: string; issuer?: string };

/**
 * The same checks for a query that did not come from a URL (the MCP tools): a bad asset code (case-sensitive),
 * a value over 64 characters, or an issuer that is not a checksum-valid account address gives null.
 * An empty issuer is not "absent": it fails.
 */
export function validateQuery(input: { asset_code: string; issuer?: string | undefined }): Query | null {
  const code = input.asset_code;
  if (typeof code !== "string" || code.length > MAX_PARAM_CHARS || !ASSET_CODE_PATTERN.test(code)) return null;
  const issuer = input.issuer;
  if (issuer === undefined) return { asset_code: code };
  if (typeof issuer !== "string" || issuer.length > MAX_PARAM_CHARS) return null;
  return StrKey.isValidEd25519PublicKey(issuer) ? { asset_code: code, issuer } : null;
}

/**
 * The validated query, or null when it is not valid: an unknown or repeated parameter, a value over
 * 64 characters, a bad asset code (case-sensitive), or an issuer that is not a checksum-valid account address.
 */
export function parseQuery(params: URLSearchParams): Query | null {
  const seen = new Set<string>();
  for (const [key, value] of params.entries()) {
    if (!ALLOWED_PARAMS.has(key) || seen.has(key) || value.length > MAX_PARAM_CHARS) return null;
    seen.add(key);
  }
  const code = params.get("asset_code");
  if (code === null) return null;
  const issuer = params.get("issuer");
  return validateQuery(issuer === null ? { asset_code: code } : { asset_code: code, issuer });
}

export type IssuerRef = { issuer: string; issuer_org: string; official_domain: string | null };

export type NotTrackedReason = "stablecoin_out_of_scope" | "unknown_code" | "issuer_not_pinned";

export type Resolution =
  | { kind: "found"; asset: LoadedAsset; row: UniverseAsset | null; codeIsUnique: boolean }
  | { kind: "not_tracked"; reason: NotTrackedReason; did_you_mean?: string[]; tracked_issuers?: IssuerRef[] }
  | { kind: "ambiguous_asset"; issuers: IssuerRef[] };

const issuerRef = (a: LoadedAsset, universe: readonly UniverseAsset[]): IssuerRef => ({
  issuer: a.issuer,
  issuer_org: a.issuer_org,
  official_domain: universe.find((u) => u.asset_code === a.asset_code && u.issuer === a.issuer)?.official_domain || null,
});

export function resolveAsset(query: Query, status: { assets: readonly LoadedAsset[] }, universe: readonly UniverseAsset[]): Resolution {
  const same = status.assets.filter((a) => a.asset_code === query.asset_code);
  if (same.length === 0) {
    if (OUT_OF_SCOPE_STABLECOINS.includes(query.asset_code)) return { kind: "not_tracked", reason: "stablecoin_out_of_scope" };
    const lower = query.asset_code.toLowerCase();
    const lookalikes = [...new Set(status.assets.map((a) => a.asset_code).filter((c) => c.toLowerCase() === lower))];
    return { kind: "not_tracked", reason: "unknown_code", ...(lookalikes.length > 0 ? { did_you_mean: lookalikes } : {}) };
  }
  if (query.issuer !== undefined) {
    const hit = same.find((a) => a.issuer === query.issuer);
    if (!hit) return { kind: "not_tracked", reason: "issuer_not_pinned", tracked_issuers: same.map((a) => issuerRef(a, universe)) };
    return { kind: "found", asset: hit, row: universe.find((u) => u.asset_code === hit.asset_code && u.issuer === hit.issuer) ?? null, codeIsUnique: same.length === 1 };
  }
  if (same.length > 1) return { kind: "ambiguous_asset", issuers: same.map((a) => issuerRef(a, universe)) };
  const only = same[0];
  return { kind: "found", asset: only, row: universe.find((u) => u.asset_code === only.asset_code && u.issuer === only.issuer) ?? null, codeIsUnique: true };
}

export type ResolutionFailure = Exclude<Resolution, { kind: "found" }>;

/**
 * The error code and the extra fields of a resolution that is not `found`, the same for `/api/check` and the MCP tools.
 * The message sentence comes from the caller (ERROR_MESSAGES), so this file stays free of copy.
 */
export function resolutionErrorBody(r: ResolutionFailure):
  | { error: "ambiguous_asset"; extras: { issuers: IssuerRef[] } }
  | { error: "not_tracked"; extras: { reason: NotTrackedReason; scope: string; tracked_issuers?: IssuerRef[]; did_you_mean?: string[] } } {
  if (r.kind === "ambiguous_asset") return { error: "ambiguous_asset", extras: { issuers: r.issuers } };
  return {
    error: "not_tracked",
    extras: {
      reason: r.reason,
      scope: SCOPE_NOTE,
      ...(r.tracked_issuers ? { tracked_issuers: r.tracked_issuers } : {}),
      ...(r.did_you_mean ? { did_you_mean: r.did_you_mean } : {}),
    },
  };
}
