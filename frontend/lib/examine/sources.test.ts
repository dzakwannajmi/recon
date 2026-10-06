import { describe, expect, it } from "vitest";
import { parseNmfp3, parseNport, tomlSupplyFields } from "./sources";

const NMFP3 = `<edgarSubmission><formData><generalInfo><reportDate>2026-08-31</reportDate></generalInfo>
<seriesLevelInfo><netAssetOfSeries>900.00</netAssetOfSeries><numberOfSharesOutstanding>900.0000</numberOfSharesOutstanding></seriesLevelInfo>
<classLevelInfo><classesId>C000000001</classesId><netAssetsOfClass>100.50</netAssetsOfClass><numberOfSharesOutstanding>100.5000</numberOfSharesOutstanding></classLevelInfo>
<classLevelInfo><classesId>C000215714</classesId><netAssetsOfClass>686635362.22</netAssetsOfClass><numberOfSharesOutstanding>686637083.5800</numberOfSharesOutstanding></classLevelInfo>
</formData></edgarSubmission>`;

describe("parseNmfp3", () => {
  it("reads the matching share class, not the series or another class", () => {
    const facts = parseNmfp3(NMFP3, "C000215714")!;
    expect(facts.find((f) => f.field === "units_outstanding")).toEqual({
      field: "units_outstanding", value: 686637083.58, unit: "shares", as_of: "2026-08-31",
      quote: "<numberOfSharesOutstanding>686637083.5800</numberOfSharesOutstanding>", section: "classLevelInfo C000215714",
    });
    expect(facts.find((f) => f.field === "net_assets")?.value).toBe(686635362.22);
    expect(facts.find((f) => f.field === "report_date")?.value).toBe("2026-08-31");
  });

  it("returns null when the class is missing or the date is malformed", () => {
    expect(parseNmfp3(NMFP3, "C999")).toBeNull();
    expect(parseNmfp3(NMFP3.replace("2026-08-31", "31/08/2026"), "C000215714")).toBeNull();
  });

  it("skips malformed numbers", () => {
    const facts = parseNmfp3(NMFP3.replace("686637083.5800", "686,637,083.58"), "C000215714")!;
    expect(facts.some((f) => f.field === "units_outstanding")).toBe(false);
  });
});

describe("parseNport", () => {
  const NPORT = "<genInfo><seriesId>S000072466</seriesId><repPdEnd>2026-06-30</repPdEnd><repPdDate>2026-06-30</repPdDate></genInfo><fundInfo><totAssets>1023758.48</totAssets><netAssets>1023716.43</netAssets></fundInfo>";

  it("reads net assets for the matching series", () => {
    const facts = parseNport(NPORT, "S000072466")!;
    expect(facts.map((f) => [f.field, f.value])).toEqual([["report_date", "2026-06-30"], ["net_assets", 1023716.43]]);
    expect(parseNport(NPORT, "S000000000")).toBeNull();
  });
});

describe("tomlSupplyFields", () => {
  const TOML = `[[CURRENCIES]]
code="OTHER"
issuer="GOTHER"
fixed_number=5

[[CURRENCIES]]
code="BB1"
issuer="GBB1"
fixed_number="2,667,360"
max_number=3000000 # cap
is_unlimited=false

[DOCUMENTATION]
fixed_number=1`;

  it("reads the supply fields of the matching currency only, quoting each line", () => {
    expect(tomlSupplyFields(TOML, "BB1", "GBB1")).toEqual([
      { field: "toml_fixed_number", value: 2667360, unit: "tokens", as_of: null, quote: 'fixed_number="2,667,360"', section: "[[CURRENCIES]] BB1" },
      { field: "toml_max_number", value: 3000000, unit: "tokens", as_of: null, quote: "max_number=3000000 # cap", section: "[[CURRENCIES]] BB1" },
      { field: "toml_is_unlimited", value: false, unit: null, as_of: null, quote: "is_unlimited=false", section: "[[CURRENCIES]] BB1" },
    ]);
    expect(tomlSupplyFields(TOML, "BB1", "GWRONG")).toEqual([]);
  });

  it("ignores malformed numbers", () => {
    expect(tomlSupplyFields('[[CURRENCIES]]\ncode="X"\nissuer="G"\nfixed_number="1,23,4"', "X", "G")).toEqual([]);
  });
});
