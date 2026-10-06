/**
 * Deterministic parsing of values read from a document span (golden rule 1:
 * the LLM points at text, code decides the value). Every function returns
 * null when the text is not an unambiguous number or date: a wrong value is
 * worse than a dropped claim.
 */

/** Number conventions of a document: "en" 1,234.5 / "de" 1.234,5 / null when unknown. */
export type Locale = "en" | "de" | null;

/** Guess a document's number locale from common function words; null when unclear. */
export function detectLocale(text: string): Locale {
  const sample = text.slice(0, 40_000).toLowerCase();
  const count = (re: RegExp) => (sample.match(re) ?? []).length;
  const de = count(/\b(der|die|das|und|nicht|werden|mit|eine?|für|von)\b/g);
  const en = count(/\b(the|and|of|with|will|are|for|this|that|from)\b/g);
  if (de >= 20 && de > en * 1.5) return "de";
  if (en >= 20 && en > de * 1.5) return "en";
  return null;
}

const GROUPED_SPACE = /^\d{1,3}([  ']\d{3})+([.,]\d+)?$/;

/** One number token → value, or null when it is malformed or ambiguous for the locale. */
export function parseNumberToken(token: string, locale: Locale = null): number | null {
  let t = token;
  if (/[  ']/.test(t)) {
    if (!GROUPED_SPACE.test(t)) return null;
    t = t.replace(/[  ']/g, "");
  }
  if (!/^\d[\d.,]*$/.test(t)) return null;
  const commas = (t.match(/,/g) ?? []).length;
  const dots = (t.match(/\./g) ?? []).length;
  let normalized: string | null = null;

  if (commas && dots) {
    if (/^\d{1,3}(,\d{3})*\.\d+$/.test(t)) normalized = t.replace(/,/g, "");
    else if (/^\d{1,3}(\.\d{3})*,\d+$/.test(t)) normalized = t.replace(/\./g, "").replace(",", ".");
  } else if (commas) {
    if (/^\d{1,3}(,\d{3}){2,}$/.test(t)) normalized = locale === "de" ? null : t.replace(/,/g, "");
    else if (/^\d{1,3},\d{3}$/.test(t)) normalized = locale === "en" ? t.replace(",", "") : locale === "de" ? t.replace(",", ".") : null;
    else if (/^\d+,\d+$/.test(t)) normalized = locale === "en" ? null : t.replace(",", ".");
  } else if (dots) {
    if (/^\d{1,3}(\.\d{3}){2,}$/.test(t)) normalized = locale === "en" ? null : t.replace(/\./g, "");
    else if (/^\d{1,3}\.\d{3}$/.test(t)) normalized = locale === "de" ? t.replace(".", "") : locale === "en" ? t : null;
    else if (/^\d+\.\d+$/.test(t)) normalized = locale === "de" ? null : t;
  } else {
    normalized = t;
  }
  return normalized === null ? null : Number(normalized);
}

const CURRENCY_CODES = /^(USD|EUR|GBP|CHF|JPY|MXN|BRL|KRW|SGD|HKD|CAD|AUD|USDC)$/;

/** Scale written right after the number, inside the span. */
const ATTACHED_SCALE: [RegExp, number][] = [
  [/^(T|tn)(?![A-Za-z-])/, 1e12],
  [/^(B|bn)(?![A-Za-z-])/, 1e9],
  [/^(M|m|mn|mm)(?![A-Za-z-])/, 1e6],
  [/^(K|k)(?![A-Za-z-])/, 1e3],
];
const SPACED_SCALE: [RegExp, number][] = [
  [/^\s+(trillions?|tn)(?![A-Za-z])/i, 1e12],
  [/^\s+(billions?|bn|mrd\.?|milliarden?)(?![A-Za-z])/i, 1e9],
  [/^\s+(millions?|mln|mn|mio\.?|millionen)(?![A-Za-z])/i, 1e6],
  [/^\s+(thousands?|tsd\.?)(?![A-Za-z])/i, 1e3],
];
/** Any scale word or suffix that may follow a number in the document (for "scale omitted" checks). */
export const FOLLOWING_SCALE = /^(\s*(T|tn|B|bn|M|m|mn|mm|K|k)(?![A-Za-z])|\s+(trillions?|billions?|millions?|thousands?|mln|mio\.?|mrd\.?|tsd\.?|millionen|milliarden?)(?![A-Za-z]))/;

const NUMBER = /\d[\d.,  ']*\d|\d/g;

/**
 * An amount span such as "$522,773,589.63", "USD 1.2 billion", "€ 3,5 Mio.",
 * "$2.30B" or "100,000 shares". Exactly one number; no sign, leading decimal
 * point, or percent; a short word right after the number must be a known
 * scale or a currency code.
 */
export function parseAmount(text: string, locale: Locale = null): number | null {
  const numbers = [...text.matchAll(NUMBER)];
  if (numbers.length !== 1) return null;
  const [match] = numbers;
  const start = match.index!;
  const before = text.slice(0, start);
  const after = text.slice(start + match[0].length);
  if (/[-−(][\s$€£]*$/.test(before) || /[.,]$/.test(before)) return null;
  if (/^\s*%/.test(after) || /^\s*\)/.test(after)) return null;

  const base = parseNumberToken(match[0], locale);
  if (base === null) return null;

  let scale = 1;
  const attached = ATTACHED_SCALE.find(([re]) => re.test(after));
  const spaced = SPACED_SCALE.find(([re]) => re.test(after));
  if (attached) scale = attached[1];
  else if (spaced) scale = spaced[1];
  else {
    const word = /^\s*([A-Za-z]{1,3})\.?(?=$|[\s\-.,;:)])/.exec(after)?.[1];
    if (word && !CURRENCY_CODES.test(word)) return null; // "5 m", "100 T-Bills", "100,000 B shares": ambiguous
    if (/^[A-Za-z]/.test(after)) return null; // letters glued to the number: "5x", "100abc"
  }
  return Math.round(base * scale * 1e7) / 1e7;
}

const MONTHS: Record<string, number> = {
  january: 1, jan: 1, januar: 1, jänner: 1,
  february: 2, feb: 2, februar: 2,
  march: 3, mar: 3, märz: 3, maerz: 3,
  april: 4, apr: 4,
  may: 5, mai: 5,
  june: 6, jun: 6, juni: 6,
  july: 7, jul: 7, juli: 7,
  august: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  october: 10, oct: 10, oktober: 10, okt: 10,
  november: 11, nov: 11,
  december: 12, dec: 12, dezember: 12, dez: 12,
};

function isoDate(y: number, m: number, d: number) {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  if (y < 1990 || y > 2100) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * A single calendar date → "YYYY-MM-DD". Accepts "August 31, 2026",
 * "Aug. 31, 2026", "31 August 2026", "31. August 2026", "2026-08-31",
 * "31.08.2026" (day first) and "08/31/2026" (only when the order is
 * unambiguous: a slash date with both parts ≤ 12 is refused).
 */
export function parseDate(text: string): string | null {
  // A trailing time of day ("7:59:59pm EDT") does not change the date.
  const t = text.trim().replace(/\s+/g, " ").replace(/,? \d{1,2}:\d{2}(:\d{2})?\s*([ap]\.?m\.?)?( [A-Z]{2,5})?$/i, "");
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return isoDate(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (m) {
    const [a, b] = [+m[1], +m[2]];
    if (a <= 12 && b <= 12 && a !== b) return null;
    return a > 12 ? isoDate(+m[3], b, a) : isoDate(+m[3], a, b);
  }
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(t);
  if (m) return isoDate(+m[3], +m[2], +m[1]);
  m = /^([A-Za-zÄäÖöÜü]+)\.? (\d{1,2}),? (\d{4})$/.exec(t);
  if (m && MONTHS[m[1].toLowerCase()]) return isoDate(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
  m = /^(\d{1,2})\.? ([A-Za-zÄäÖöÜü]+)\.?,? (\d{4})$/.exec(t);
  if (m && MONTHS[m[2].toLowerCase()]) return isoDate(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
  return null;
}
