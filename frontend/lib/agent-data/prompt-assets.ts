import { loadUniverse } from "../chain/universe";

/** The tracked assets for the prompt bar's source list: code, and issuer or type as the description. Server only. */
export function loadPromptAssets(): { code: string; description: string }[] {
  const seen = new Set<string>();
  const out: { code: string; description: string }[] = [];
  for (const a of loadUniverse()) {
    if (seen.has(a.asset_code)) continue;
    seen.add(a.asset_code);
    out.push({ code: a.asset_code, description: a.issuer_org || a.asset_type });
  }
  return out;
}
