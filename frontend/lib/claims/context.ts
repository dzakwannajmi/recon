/**
 * The one place that builds the quote verifier's input for a stored document.
 * `extract:claims` (LLM proposals) and `import:review` (operator proposals) both
 * go through it, so a claim is checked the same way whoever proposed it.
 */
import { findCurrency, parseStellarToml } from "../chain/toml";
import type { UniverseAsset } from "../chain/universe";
import { EXTRACTOR_VERSION } from "../documents/extract";
import { sha256Hex, type SnapshotRecord } from "../documents/store";
import { detectLocale } from "./parse";
import { normalizeForMatch, type AssetRef, type VerifyContext } from "./verify";

/** The part of SnapshotStore the factory needs (so tests can pass a plain object). */
export type SnapshotSource = { all(): readonly SnapshotRecord[]; readText(sha256: string): string | null };

/** Tickers an amount could belong to: the universe plus a few well-known ones. */
export const knownCodes = (universe: UniverseAsset[]) => [...new Set([...universe.map((a) => a.asset_code), "XLM", "USDC", "OUSG", "USTB"])];

/** Asset display names from the issuers' own tomls help attribute claims in multi-asset documents. */
export function assetNames(snapshots: SnapshotSource) {
  const names = new Map<string, string>();
  for (const r of snapshots.all().filter((s) => s.sourceClass === "issuer_toml")) {
    const text = snapshots.readText(r.sha256);
    if (!text) continue;
    const { toml } = parseStellarToml(text);
    for (const key of r.assets) {
      const [code, issuer] = key.split(":");
      const name = findCurrency(toml, issuer, code)?.name;
      if (typeof name === "string") names.set(key, name);
    }
  }
  return names;
}

export function createContextFactory(universe: UniverseAsset[], snapshots: SnapshotSource) {
  const names = assetNames(snapshots);
  const codes = knownCodes(universe);
  const universeOf = (record: SnapshotRecord) => universe.filter((a) => record.assets.includes(`${a.asset_code}:${a.issuer}`));
  const pinnedFor = (record: SnapshotRecord) =>
    universeOf(record)
      .flatMap((a) => a.docs_urls.split(";").map((u) => u.trim()).filter(Boolean))
      .map((u) => {
        try {
          return new URL(u).toString();
        } catch {
          return u;
        }
      });
  const officialDomainsOf = (record: SnapshotRecord) => universeOf(record).map((a) => a.official_domain);
  const assetRefsOf = (record: SnapshotRecord): AssetRef[] => record.assets.map((k) => ({ code: k.split(":")[0], name: names.get(k) }));

  /** Verification context for one document, or null if its stored text is stale. */
  function contextFor(record: SnapshotRecord): { ctx: VerifyContext; text: string } | null {
    const text = snapshots.readText(record.sha256);
    if (!text || !record.text || sha256Hex(text) !== record.text.sha256 || record.text.extractor !== EXTRACTOR_VERSION) return null;
    const assets = assetRefsOf(record);
    return {
      text,
      ctx: {
        text,
        normalized: normalizeForMatch(text),
        isPdf: record.text.kind === "pdf",
        locale: record.sourceClass === "issuer_toml" ? "en" : detectLocale(text),
        assets,
        // A prospectus PDF, or a page pinned in that asset's docs_urls, is about that asset only.
        dedicated: assets.length === 1 && (record.text.kind === "pdf" || pinnedFor(record).includes(record.url)),
        knownCodes: codes,
      },
    };
  }

  return { contextFor, officialDomainsOf, assetRefsOf, names };
}
