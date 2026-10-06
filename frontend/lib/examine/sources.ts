/**
 * Deterministic facts from structured sources (no LLM): SEC fund filings
 * (N-MFP3, NPORT-P) and the SEP-1 supply fields of an issuer's stellar.toml.
 * Every fact carries a verbatim quote from the snapshot and the character
 * offset where it sits (golden rule 2), so the quote is checked at its exact
 * place, not just anywhere in the file.
 */

export type SourceFact = {
  field: "units_outstanding" | "net_assets" | "report_date" | "toml_fixed_number" | "toml_max_number" | "toml_is_unlimited";
  value: number | string | boolean;
  unit: string | null;
  as_of: string | null;
  quote: string;
  /** Character offset of the quote in the document text. */
  offset: number;
  /** Where in the document: e.g. "classLevelInfo C000215714" or "[[CURRENCIES]] BB1, line 12". */
  section: string;
};

const DECIMAL = /^\d+(\.\d+)?$/;
/** Larger than any Stellar amount (int64 stroops / 10^7). */
const MAX_TOKENS = 922_337_203_685;

/** The first `<tag>value</tag>` at or after `from`, with its exact text and offset. */
function element(xml: string, tag: string, from = 0, to = xml.length) {
  const re = new RegExp(`<${tag}>([^<]*)</${tag}>`, "g");
  re.lastIndex = from;
  const m = re.exec(xml);
  if (!m || m.index >= to) return null;
  return { value: m[1].trim(), quote: m[0], offset: m.index };
}

const amount = (el: { value: string } | null) => (el && DECIMAL.test(el.value) ? Number(el.value) : null);

/**
 * N-MFP3 (money market fund monthly report): the share class's shares
 * outstanding and net assets, and the report date. Values come only from the
 * matching <classLevelInfo> block, never from the series level.
 */
export function parseNmfp3(xml: string, classId: string): SourceFact[] | null {
  const reportDate = element(xml, "reportDate");
  if (!reportDate || !/^\d{4}-\d{2}-\d{2}$/.test(reportDate.value)) return null;
  const blocks = [...xml.matchAll(/<classLevelInfo>[\s\S]*?<\/classLevelInfo>/g)];
  const block = blocks.find((b) => element(xml, "classesId", b.index!, b.index! + b[0].length)?.value === classId);
  if (!block) return null;
  const [start, end] = [block.index!, block.index! + block[0].length];
  const shares = element(xml, "numberOfSharesOutstanding", start, end);
  const netAssets = element(xml, "netAssetsOfClass", start, end);
  const section = `classLevelInfo ${classId}`;
  const facts: SourceFact[] = [
    { field: "report_date", value: reportDate.value, unit: null, as_of: reportDate.value, quote: reportDate.quote, offset: reportDate.offset, section: "generalInfo" },
  ];
  if (amount(shares) !== null) facts.push({ field: "units_outstanding", value: amount(shares)!, unit: "shares", as_of: reportDate.value, quote: shares!.quote, offset: shares!.offset, section });
  if (amount(netAssets) !== null) facts.push({ field: "net_assets", value: amount(netAssets)!, unit: "USD", as_of: reportDate.value, quote: netAssets!.quote, offset: netAssets!.offset, section });
  return facts;
}

/** NPORT-P (fund portfolio report): the series' net assets on the report date (repPdDate). */
export function parseNport(xml: string, seriesId: string): SourceFact[] | null {
  const series = element(xml, "seriesId");
  const reportDate = element(xml, "repPdDate");
  if (series?.value !== seriesId || !reportDate || !/^\d{4}-\d{2}-\d{2}$/.test(reportDate.value)) return null;
  const netAssets = element(xml, "netAssets");
  const facts: SourceFact[] = [
    { field: "report_date", value: reportDate.value, unit: null, as_of: reportDate.value, quote: reportDate.quote, offset: reportDate.offset, section: "genInfo" },
  ];
  if (amount(netAssets) !== null) facts.push({ field: "net_assets", value: amount(netAssets)!, unit: "USD", as_of: reportDate.value, quote: netAssets!.quote, offset: netAssets!.offset, section: "fundInfo" });
  return facts;
}

const CURRENCIES_HEADER = /^\s*\[\[\s*CURRENCIES\s*\]\]\s*(#.*)?$/;
const TABLE_HEADER = /^\s*\[/;
const KEY_VALUE = /^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*(.*?)\s*$/;

/** A TOML scalar: "..." or '...' or bare; unbalanced quotes give null. Inline comments are dropped. */
function scalar(raw: string): string | null {
  const m = /^"([^"]*)"(\s*#.*)?$|^'([^']*)'(\s*#.*)?$|^([^"'#\s][^"'#]*?)(\s*#.*)?$/.exec(raw);
  if (!m) return null;
  return (m[1] ?? m[3] ?? m[5] ?? "").trim();
}

type Line = { text: string; offset: number; number: number };

/** The [[CURRENCIES]] entries of a toml, each as its own lines (up to the next table), skipping multi-line strings. */
function currencyEntries(text: string): Line[][] {
  const entries: Line[][] = [];
  let current: Line[] | null = null;
  let multiline: string | null = null;
  let offset = 0;
  text.split("\n").forEach((raw, i) => {
    const line = { text: raw.replace(/\r$/, ""), offset, number: i + 1 };
    offset += raw.length + 1;
    if (multiline) {
      if (raw.includes(multiline)) multiline = null;
      return;
    }
    const delimiter = ['"""', "'''"].find((d) => raw.includes(d));
    if (delimiter && (raw.split(delimiter).length - 1) % 2 === 1) {
      multiline = delimiter;
      return;
    }
    if (CURRENCIES_HEADER.test(line.text)) {
      current = [];
      entries.push(current);
    } else if (TABLE_HEADER.test(line.text)) {
      current = null;
    } else if (current) {
      current.push(line);
    }
  });
  return entries;
}

/**
 * SEP-1 supply fields for one currency: fixed_number, max_number,
 * is_unlimited, read only from the [[CURRENCIES]] entry whose code and issuer
 * match (both inside that entry). A key that appears twice gives no fact.
 */
export function tomlSupplyFields(tomlText: string, code: string, issuer: string): SourceFact[] {
  const entry = currencyEntries(tomlText).find((lines) => {
    const values = (key: string) => lines.map((l) => KEY_VALUE.exec(l.text)).filter((m) => m && m[1] === key).map((m) => scalar(m![2]));
    const codes = values("code");
    const issuers = values("issuer");
    return codes.length === 1 && codes[0] === code && issuers.length === 1 && issuers[0] === issuer;
  });
  if (!entry) return [];

  const facts: SourceFact[] = [];
  for (const key of ["fixed_number", "max_number", "is_unlimited"] as const) {
    const lines = entry.filter((l) => KEY_VALUE.exec(l.text)?.[1] === key);
    if (lines.length !== 1) continue; // missing, or a duplicate key (invalid TOML)
    const [line] = lines;
    const value = scalar(KEY_VALUE.exec(line.text)![2]);
    if (value === null) continue;
    const quote = line.text.trim();
    const offset = line.offset + line.text.indexOf(quote);
    const section = `[[CURRENCIES]] ${code}, line ${line.number}`;
    if (key === "is_unlimited") {
      if (value === "true" || value === "false") facts.push({ field: "toml_is_unlimited", value: value === "true", unit: null, as_of: null, quote, offset, section });
      continue;
    }
    // SEP-1 says integer; accept TOML "1_000" and quoted "2,667,360" thousands groups.
    if (!/^\d{1,3}(,\d{3})*$|^\d+(_\d+)*$/.test(value)) continue;
    const n = Number(value.replace(/[,_]/g, ""));
    if (!Number.isSafeInteger(n) || n > MAX_TOKENS) continue;
    facts.push({ field: key === "fixed_number" ? "toml_fixed_number" : "toml_max_number", value: n, unit: "tokens", as_of: null, quote, offset, section });
  }
  return facts;
}
