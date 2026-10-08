import { describe, expect, it } from "vitest";
import { parseNmfp3, parseNport, tomlSupplyFields } from "./sources";

const NMFP3 = `<edgarSubmission><formData><generalInfo><reportDate>2026-08-31</reportDate></generalInfo>
<seriesLevelInfo><netAssetOfSeries>900.00</netAssetOfSeries><numberOfSharesOutstanding>900.0000</numberOfSharesOutstanding></seriesLevelInfo>
<classLevelInfo><classesId>C000000001</classesId><netAssetsOfClass>100.50</netAssetsOfClass><numberOfSharesOutstanding>100.5000</numberOfSharesOutstanding></classLevelInfo>
<classLevelInfo><classesId>C000215714</classesId><netAssetsOfClass>686635362.22</netAssetsOfClass><numberOfSharesOutstanding>686637083.5800</numberOfSharesOutstanding></classLevelInfo>
</formData></edgarSubmission>`;

const at = (text: string, f: { offset: number; quote: string }) => text.slice(f.offset, f.offset + f.quote.length);

describe("parseNmfp3", () => {
  it("reads the matching share class, not the series or another class, with exact offsets", () => {
    const facts = parseNmfp3(NMFP3, "C000215714")!;
    const shares = facts.find((f) => f.field === "units_outstanding")!;
    expect(shares).toMatchObject({ value: 686637083.58, unit: "shares", as_of: "2026-08-31", quote: "<numberOfSharesOutstanding>686637083.5800</numberOfSharesOutstanding>", section: "classLevelInfo C000215714" });
    expect(at(NMFP3, shares)).toBe(shares.quote);
    expect(shares.offset).toBeGreaterThan(NMFP3.indexOf("C000215714"));
    expect(facts.find((f) => f.field === "net_assets")?.value).toBe(686635362.22);
  });

  it("never falls back to the series or another class when the class lacks a value", () => {
    const xml = NMFP3.replace("<numberOfSharesOutstanding>686637083.5800</numberOfSharesOutstanding>", "");
    expect(parseNmfp3(xml, "C000215714")!.some((f) => f.field === "units_outstanding")).toBe(false);
  });

  it("returns null when the class is missing or the date is malformed, and skips malformed numbers", () => {
    expect(parseNmfp3(NMFP3, "C999")).toBeNull();
    expect(parseNmfp3(NMFP3.replace("2026-08-31", "31/08/2026"), "C000215714")).toBeNull();
    expect(parseNmfp3(NMFP3.replace("686637083.5800", "686,637,083.58"), "C000215714")!.some((f) => f.field === "units_outstanding")).toBe(false);
  });
});

describe("parseNport", () => {
  const NPORT = "<genInfo><seriesId>S000072466</seriesId><repPdEnd>2026-12-31</repPdEnd><repPdDate>2026-06-30</repPdDate></genInfo><fundInfo><totAssets>1023758.48</totAssets><netAssets>1023716.43</netAssets></fundInfo>";

  it("reads net assets for the matching series as of the report date, not the fiscal year end", () => {
    const facts = parseNport(NPORT, "S000072466")!;
    expect(facts.map((f) => [f.field, f.value, f.as_of])).toEqual([["report_date", "2026-06-30", "2026-06-30"], ["net_assets", 1023716.43, "2026-06-30"]]);
    expect(parseNport(NPORT, "S000000000")).toBeNull();
    expect(parseNport(NPORT.replace(/<repPdDate>.*<\/repPdDate>/, ""), "S000072466")).toBeNull();
  });
});

describe("tomlSupplyFields", () => {
  const TOML = `[[CURRENCIES]]
code="OTHER"
issuer="GOTHER"
fixed_number=5

[[CURRENCIES]] # second entry
code = "BB1"
issuer = 'GBB1'
fixed_number="2,667,360"
max_number=3_000_000 # cap
is_unlimited=false
desc="""
fixed_number=999
"""

[DOCUMENTATION]
fixed_number=1`;

  it("reads only the matching entry (commented header, spaces, single quotes), quoting each line at its offset", () => {
    const facts = tomlSupplyFields(TOML, "BB1", "GBB1");
    expect(facts.map((f) => [f.field, f.value, f.quote])).toEqual([
      ["toml_fixed_number", 2667360, 'fixed_number="2,667,360"'],
      ["toml_max_number", 3000000, "max_number=3_000_000 # cap"],
      ["toml_is_unlimited", false, "is_unlimited=false"],
    ]);
    for (const f of facts) expect(TOML.slice(f.offset, f.offset + f.quote.length)).toBe(f.quote);
    expect(facts[0].section).toBe("[[CURRENCIES]] BB1, line 9");
    expect(tomlSupplyFields(TOML, "BB1", "GWRONG")).toEqual([]);
  });

  it("never takes a value from another entry or table", () => {
    const toml = `[[CURRENCIES]]\ncode="A"\nissuer="GA"\nfixed_number=5\n[[ CURRENCIES ]]\ncode="B"\nissuer="GB"\n[EXTRA]\nfixed_number=10`;
    expect(tomlSupplyFields(toml, "B", "GB")).toEqual([]);
    expect(tomlSupplyFields(toml, "A", "GA")[0].value).toBe(5);
  });

  it("gives nothing for duplicate keys, unbalanced quotes, or malformed numbers", () => {
    const entry = (body: string) => `[[CURRENCIES]]\ncode="X"\nissuer="G"\n${body}`;
    expect(tomlSupplyFields(entry("fixed_number=100\nfixed_number=200"), "X", "G")).toEqual([]);
    expect(tomlSupplyFields(entry('fixed_number="1,000'), "X", "G")).toEqual([]);
    expect(tomlSupplyFields(entry('max_number=2000"'), "X", "G")).toEqual([]);
    expect(tomlSupplyFields(entry('fixed_number="1,23,4"'), "X", "G")).toEqual([]);
    expect(tomlSupplyFields(entry("fixed_number=12345678901234567891"), "X", "G")).toEqual([]);
  });

  it("reads a WisdomTree-shaped toml whose ACCOUNTS line is missing a closing quote", () => {
    const toml = `ACCOUNTS=[\n"GA",\n"GB\n]\n[[CURRENCIES]]\ncode="CRDT"\nissuer="GB"\nis_unlimited=true\n`;
    expect(tomlSupplyFields(toml, "CRDT", "GB").map((f) => f.value)).toEqual([true]);
  });
});
