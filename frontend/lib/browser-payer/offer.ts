/**
 * Reads a `get_evidence_bundle` step from the chat. The step result is data from our own tool, but the asset code
 * and issuer are validated again here and the detail URL is rebuilt from them, never taken from the result.
 */
import { detailUrl } from "./pay";

export type Offer = { available: boolean; assetCode: string; issuer: string | null; url: string | null };

export function parseOffer(step: { tool: string; result?: unknown }): Offer | null {
  if (step.tool !== "get_evidence_bundle") return null;
  const r = step.result as { premium?: unknown; available?: unknown; asset_code?: unknown; issuer?: unknown } | null | undefined;
  if (!r || typeof r !== "object" || r.premium !== true || typeof r.asset_code !== "string") return null;
  const issuer = typeof r.issuer === "string" ? r.issuer : null;
  const url = issuer ? detailUrl(r.asset_code, issuer) : null;
  if (!/^[A-Za-z0-9]{1,12}$/.test(r.asset_code)) return null;
  return { available: r.available === true && url !== null, assetCode: r.asset_code, issuer, url };
}

/** One offer per asset, in order of first appearance. */
export function offersOf(steps: { tool: string; result?: unknown }[] | undefined): Offer[] {
  const seen = new Set<string>();
  const out: Offer[] = [];
  for (const s of steps ?? []) {
    const o = parseOffer(s);
    const key = o ? `${o.assetCode}:${o.issuer ?? ""}` : "";
    if (o && !seen.has(key)) {
      seen.add(key);
      out.push(o);
    }
  }
  return out;
}
