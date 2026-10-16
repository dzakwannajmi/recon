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

export type OrbitCompany = { issuer: string; src: string | null };

/** Company marks for the landing orbit: one per issuer, kept under public/logos (see SOURCES.md). */
const COMPANY_LOGO_FILES: Readonly<Record<string, string>> = {
  "Ondo Finance": "ondo.png",
  Etherfuse: "etherfuse-e.png",
  "WisdomTree, Inc.": "wisdomtree.png",
  "Bitbond Finance GmbH": "bitbond.png",
  "Figure Certificate Company": "figure.svg",
};

/** One entry per issuer, in the order given. An issuer without a published mark gets null (the orbit shows letters). */
export function orbitCompanies(issuers: string[]): OrbitCompany[] {
  return [...new Set(issuers)].map((issuer) => {
    if (issuer === "Franklin Templeton") return { issuer, src: FRANKLIN_ILLUSTRATION };
    const file = Object.hasOwn(COMPANY_LOGO_FILES, issuer) ? COMPANY_LOGO_FILES[issuer] : undefined;
    return { issuer, src: file ? `/logos/${file}` : null };
  });
}
