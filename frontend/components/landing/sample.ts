import type { LoadedAsset, StatusFile } from "@/lib/factsheet/load";

type Evidence = LoadedAsset["raised"][number]["evidence"][number];
export type Sample = { asset: LoadedAsset; flag: LoadedAsset["raised"][number]; quote: Evidence & { quote: string } };

const PREFERRED = "BB1";

const hasQuote = (e: Evidence): e is Evidence & { quote: string } => typeof e.quote === "string" && e.quote.length > 0;

/**
 * The asset shown in the landing chat sample: one with a raised flag backed by a quote from a document.
 * Prefers a fixed code so the page does not change with every status file; falls back to the first one that fits.
 * Everything shown comes from the status file as written; nothing is composed here.
 */
export function pickSample(status: Pick<StatusFile, "assets">): Sample | null {
  const fits = (a: LoadedAsset): Sample | null => {
    for (const flag of a.raised) {
      const quote = flag.evidence.find(hasQuote);
      if (quote) return { asset: a, flag, quote };
    }
    return null;
  };
  const preferred = status.assets.filter((a) => a.asset_code === PREFERRED).map(fits).find(Boolean);
  if (preferred) return preferred;
  for (const a of status.assets) {
    const s = fits(a);
    if (s) return s;
  }
  return null;
}
