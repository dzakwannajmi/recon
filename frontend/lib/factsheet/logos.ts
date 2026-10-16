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

/**
 * Franklin Templeton publishes no token image. This engraved head is an illustration chosen by the project,
 * not a logo the issuer published; it is used only in the landing orbit, never on a fact sheet.
 */
export const FRANKLIN_ILLUSTRATION = "/logos/franklin.png";

export type OrbitLogo = { src: string; name: string };

/** One logo per distinct image, for the landing orbit. `name` is the issuer, plus the code when one asset owns the image. */
export function orbitLogos(groups: { issuer: string; assets: { code: string }[] }[]): OrbitLogo[] {
  const bySrc = new Map<string, { issuer: string; codes: string[] }>();
  for (const g of groups) {
    for (const a of g.assets) {
      const src = logoFor(a.code) ?? (g.issuer === "Franklin Templeton" ? FRANKLIN_ILLUSTRATION : null);
      if (!src) continue;
      const hit = bySrc.get(src) ?? { issuer: g.issuer, codes: [] };
      hit.codes.push(a.code);
      bySrc.set(src, hit);
    }
  }
  return [...bySrc].map(([src, h]) => ({ src, name: h.codes.length === 1 ? `${h.issuer} ${h.codes[0]}` : h.issuer }));
}
