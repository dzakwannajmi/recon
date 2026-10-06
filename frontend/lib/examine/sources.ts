/**
 * Deterministic facts from structured sources (no LLM): SEC fund filings
 * (N-MFP3, NPORT-P) and the SEP-1 supply fields of an issuer's stellar.toml.
 * Every fact carries a verbatim quote from the snapshot (golden rule 2):
 * the XML element or toml line exactly as it appears.
 */

export type SourceFact = {
  field: "units_outstanding" | "net_assets" | "report_date" | "toml_fixed_number" | "toml_max_number" | "toml_is_unlimited";
  value: number | string | boolean;
  unit: string | null;
  as_of: string | null;
  quote: string;
  /** Where in the document: e.g. "classLevelInfo C000215714" or "[[CURRENCIES]] BB1". */
  section: string;
};

const DECIMAL = /^\d+(\.\d+)?$/;

/** The first `<tag>value</tag>` inside `block`, with the exact element text as its quote. */
function element(block: string, tag: string) {
  const m = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(block);
  return m ? { value: m[1].trim(), quote: m[0] } : null;
}

function amount(el: { value: string; quote: string } | null) {
  return el && DECIMAL.test(el.value) ? Number(el.value) : null;
}

/**
 * N-MFP3 (money market fund monthly report): the share class's shares
 * outstanding and net assets, and the report date. Null if the class is not
 * in the filing or the numbers are malformed.
 */
export function parseNmfp3(xml: string, classId: string): SourceFact[] | null {
  const reportDate = element(xml, "reportDate");
  if (!reportDate || !/^\d{4}-\d{2}-\d{2}$/.test(reportDate.value)) return null;
  const block = [...xml.matchAll(/<classLevelInfo>([\s\S]*?)<\/classLevelInfo>/g)].map((m) => m[1]).find((b) => element(b, "classesId")?.value === classId);
  if (!block) return null;
  const shares = element(block, "numberOfSharesOutstanding");
  const netAssets = element(block, "netAssetsOfClass");
  const facts: SourceFact[] = [{ field: "report_date", value: reportDate.value, unit: null, as_of: reportDate.value, quote: reportDate.quote, section: "generalInfo" }];
  const section = `classLevelInfo ${classId}`;
  if (amount(shares) !== null) facts.push({ field: "units_outstanding", value: amount(shares)!, unit: "shares", as_of: reportDate.value, quote: shares!.quote, section });
  if (amount(netAssets) !== null) facts.push({ field: "net_assets", value: amount(netAssets)!, unit: "USD", as_of: reportDate.value, quote: netAssets!.quote, section });
  return facts;
}

/** NPORT-P (fund portfolio report): the series' net assets at the end of the reporting period. */
export function parseNport(xml: string, seriesId: string): SourceFact[] | null {
  const series = element(xml, "seriesId");
  const periodEnd = element(xml, "repPdDate") ?? element(xml, "repPdEnd");
  if (series?.value !== seriesId || !periodEnd || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd.value)) return null;
  const netAssets = element(xml, "netAssets");
  const facts: SourceFact[] = [{ field: "report_date", value: periodEnd.value, unit: null, as_of: periodEnd.value, quote: periodEnd.quote, section: "genInfo" }];
  if (amount(netAssets) !== null) facts.push({ field: "net_assets", value: amount(netAssets)!, unit: "USD", as_of: periodEnd.value, quote: netAssets!.quote, section: "fundInfo" });
  return facts;
}

/**
 * SEP-1 supply fields for one currency in a stellar.toml text: fixed_number,
 * max_number, is_unlimited. Read line by line inside the [[CURRENCIES]] entry
 * whose code and issuer match, so each fact quotes its exact line.
 */
export function tomlSupplyFields(tomlText: string, code: string, issuer: string): SourceFact[] {
  const entries = tomlText.split(/^\s*\[\[CURRENCIES\]\]\s*$/m).slice(1);
  const entry = entries.find((e) => {
    const lines = e.split(/\r?\n/).map((l) => l.trim());
    return lines.includes(`code="${code}"`) && lines.includes(`issuer="${issuer}"`);
  });
  if (!entry) return [];
  const body = entry.split(/^\s*\[/m)[0]; // stop at the next table
  const section = `[[CURRENCIES]] ${code}`;
  const facts: SourceFact[] = [];
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    const m = /^(fixed_number|max_number|is_unlimited)\s*=\s*(.+)$/.exec(line);
    if (!m) continue;
    const valueText = m[2].replace(/\s+#.*$/, "").trim();
    if (m[1] === "is_unlimited") {
      if (valueText === "true" || valueText === "false") facts.push({ field: "toml_is_unlimited", value: valueText === "true", unit: null, as_of: null, quote: line, section });
      continue;
    }
    // SEP-1 says integer; issuers sometimes quote it with thousands separators ("2,667,360").
    const digits = valueText.replace(/^"|"$/g, "");
    if (!/^\d{1,3}(,\d{3})*$|^\d+$/.test(digits)) continue;
    facts.push({
      field: m[1] === "fixed_number" ? "toml_fixed_number" : "toml_max_number",
      value: Number(digits.replace(/,/g, "")),
      unit: "tokens",
      as_of: null,
      quote: line,
      section,
    });
  }
  return facts;
}
