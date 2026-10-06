/**
 * Deterministic parsing of values the LLM copied from a quote (golden rule 1:
 * the LLM proposes text, code decides the value). Returns null when the text
 * is not an unambiguous number or date.
 */

const SCALES: [RegExp, number][] = [
  // Single-letter suffixes right after the number ("$2.30B", "$450M", "12K"); upper case only, so "m" (metres) or "b" never scale.
  [/^T(?![A-Za-z])/, 1e12],
  [/^B(?![A-Za-z])/, 1e9],
  [/^M(?![A-Za-z])/, 1e6],
  [/^K(?![A-Za-z])/, 1e3],
  [/^(?:trillion|tn)\b/i, 1e12],
  [/^(?:billion|bn|mrd\.?|milliarden?)(?![a-z])/i, 1e9],
  [/^(?:million|mn|mm|mio\.?|millionen)(?![a-z])/i, 1e6],
  [/^(?:thousand|k|tsd\.?)(?![a-z])/i, 1e3],
];

/** "1,234.56" (US) or "1.234,56" (EU) or "1234" → number; null if ambiguous or malformed. */
export function parseNumberToken(token: string): number | null {
  const t = token.replace(/[\s  ']/g, "");
  if (!/^\d[\d.,]*$/.test(t)) return null;
  const commas = (t.match(/,/g) ?? []).length;
  const dots = (t.match(/\./g) ?? []).length;
  let normalized: string;
  if (commas && dots) {
    // The last separator is the decimal mark.
    normalized = t.lastIndexOf(",") > t.lastIndexOf(".") ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  } else if (commas) {
    // "1,234,567" groups; a single comma followed by 1-2 digits is a decimal comma ("3,5"); "1,234" stays a group.
    normalized = /^\d{1,3}(,\d{3})+$/.test(t) ? t.replace(/,/g, "") : commas === 1 && /,\d{1,2}$/.test(t) ? t.replace(",", ".") : "";
  } else if (dots > 1) {
    normalized = /^\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, "") : "";
  } else {
    normalized = t;
  }
  if (!normalized || !/^\d+(\.\d+)?$/.test(normalized)) return null;
  return Number(normalized);
}

/**
 * A money or quantity amount such as "$522,773,589.63", "USD 1.2 billion",
 * "€ 3,5 Mio." or "100,000 shares". Exactly one number must be present.
 */
export function parseAmount(text: string): number | null {
  const numbers = [...text.matchAll(/\d[\d.,\s  ']*\d|\d/g)];
  if (numbers.length !== 1) return null;
  const [match] = numbers;
  const base = parseNumberToken(match[0].trim());
  if (base === null) return null;
  const rest = text.slice(match.index! + match[0].length).trimStart();
  const scale = SCALES.find(([re]) => re.test(rest))?.[1] ?? 1;
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
 * "08/31/2026" (US order) and "31.08.2026" (day first).
 */
export function parseDate(text: string): string | null {
  // A trailing time of day ("7:59:59pm EDT") does not change the date.
  const t = text.trim().replace(/\s+/g, " ").replace(/,? \d{1,2}:\d{2}(:\d{2})?\s*([ap]\.?m\.?)?( [A-Z]{2,5})?$/i, "");
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return isoDate(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (m) return isoDate(+m[3], +m[1], +m[2]);
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(t);
  if (m) return isoDate(+m[3], +m[2], +m[1]);
  m = /^([A-Za-zÄäÖöÜü]+)\.? (\d{1,2}),? (\d{4})$/.exec(t);
  if (m && MONTHS[m[1].toLowerCase()]) return isoDate(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
  m = /^(\d{1,2})\.? ([A-Za-zÄäÖöÜü]+)\.?,? (\d{4})$/.exec(t);
  if (m && MONTHS[m[2].toLowerCase()]) return isoDate(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
  return null;
}
