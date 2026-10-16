/**
 * Token logos kept under public/logos (sources in public/logos/SOURCES.md).
 * An asset without an entry has no published token image: the landing shows a letter tile, never a made-up logo.
 */
const WISDOMTREE = ["GOLD", "WTGX", "WTSY", "WTTS", "WTST", "WTLG", "FLTT", "TIPS", "WTSI", "CRDT", "SPXU", "TECH", "EQTY", "MODR", "LNGV"];

export const LOGO_FILES: Readonly<Record<string, string>> = {
  USDY: "usdy.png",
  USTRY: "etherfuse-ustry.png",
  TESOURO: "etherfuse-tesouro.png",
  EUROB: "etherfuse-eurob.png",
  KTB: "etherfuse-ktb.png",
  GILTS: "etherfuse-gilts.png",
  BB1: "bitbond.png",
  YLDS: "figure.svg",
  ...Object.fromEntries(WISDOMTREE.map((c) => [c, "wisdomtree.png"])),
};

/** The local path of the asset's logo, or null when the issuer publishes none. */
export function logoFor(code: string): string | null {
  const file = Object.hasOwn(LOGO_FILES, code) ? LOGO_FILES[code] : undefined;
  return file ? `/logos/${file}` : null;
}

/** Two letters for the fallback tile. */
export const initialsOf = (code: string): string => code.slice(0, 2).toUpperCase();
