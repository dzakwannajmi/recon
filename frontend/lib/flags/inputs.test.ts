import { describe, expect, it } from "vitest";
import type { Claim } from "../claims/store";
import type { StoredSourceFact } from "../examine/sources";
import { KEY, check, row, snapshot } from "./fixtures";
import { datedFiles, examChecksFor, parseAsOf, reportDatesFor, rowFor } from "./inputs";
import { isIsoDay } from "./types";

const fact = (over: Partial<StoredSourceFact> = {}): StoredSourceFact => ({
  field: "report_date", value: "2026-08-31", unit: null, as_of: "2026-08-31", quote: "<reportDate>2026-08-31</reportDate>", offset: 10, section: "generalInfo",
  asset: KEY, source_url: "https://www.sec.gov/x.xml", source_class: "regulatory_filing", snapshot_sha256: "sha-sec", field_source: "code", label: "SEC N-MFP3 filed 2026-09-04", ...over,
});
const sec = (form: string) => snapshot({ sha256: "sha-sec", sourceClass: "regulatory_filing", filing: { cik: "1", form, accession: "a", filedAt: "2026-09-04" } });
const claim = (over: Partial<Claim> = {}): Claim => ({
  id: "c1", doc_key: "d", asset: KEY, field: "report_date", field_source: "llm", value: "2026-09-30", value_text: "30 September 2026", unit: null, as_of: null,
  quote: "as of 30 September 2026", source_url: "https://bitbondsto.com/r.pdf", source_class: "issuer", page: 2, snapshot_sha256: "sha-r", text_sha256: "t", extractor: "x",
  model: "m", prompt_version: "p", verified: true, extracted_at: "2026-10-07T00:00:00Z", ...over,
});

describe("reportDatesFor", () => {
  it("reads filing report dates with the form of their snapshot, stripping /A", () => {
    const [r] = reportDatesFor(KEY, [fact()], [], [sec("N-MFP3/A")]);
    expect(r).toMatchObject({ date: "2026-08-31", form: "N-MFP3", label: "SEC N-MFP3 filed 2026-09-04" });
    expect(r.evidence).toMatchObject({ kind: "source_fact", snapshot_sha256: "sha-sec", quote: "<reportDate>2026-08-31</reportDate>", where: "generalInfo" });
  });

  it("skips other fields, other assets, and facts whose snapshot is not a filing", () => {
    const out = reportDatesFor(KEY, [fact({ field: "net_assets", value: 5 }), fact({ asset: "X:G" }), fact({ snapshot_sha256: "unknown" })], [], [sec("NPORT-P")]);
    expect(out).toEqual([]);
  });

  it("reads verified issuer claims as issuer documents, from the value or the as-of date", () => {
    const out = reportDatesFor(KEY, [], [claim(), claim({ id: "c2", value: 5, as_of: "2026-09-01" }), claim({ id: "c3", value: "n/a" }), claim({ id: "c4", asset: "X:G" }), claim({ id: "c5", field: "nav_per_unit" })], []);
    expect(out.map((r) => [r.date, r.form])).toEqual([["2026-09-30", null], ["2026-09-01", null]]);
    expect(out[0].label).toBe("issuer document https://bitbondsto.com/r.pdf, page 2");
    expect(out[0].evidence).toMatchObject({ kind: "claim", ref: "c1", quote: "as of 30 September 2026", where: "page 2" });
  });
});

describe("isIsoDay", () => {
  it("accepts only real calendar dates", () => {
    expect(isIsoDay("2026-10-08")).toBe(true);
    expect(isIsoDay("2024-02-29")).toBe(true);
    for (const bad of ["2026-02-30", "2026-13-01", "2026-10-8", "2026-10-08T00:00:00Z", "", "not a date"]) expect(isIsoDay(bad)).toBe(false);
  });

  it("skips a filing fact with an impossible date", () => {
    expect(reportDatesFor(KEY, [fact({ value: "2026-02-30" })], [], [sec("N-MFP3")])).toEqual([]);
  });
});

describe("parseAsOf", () => {
  it("defaults to today and takes --as-of", () => {
    expect(parseAsOf([], "2026-10-08")).toBe("2026-10-08");
    expect(parseAsOf(["--as-of", "2026-09-01"], "2026-10-08")).toBe("2026-09-01");
  });

  it("fails on a bad format, an impossible date, or a missing value", () => {
    for (const bad of ["2026-02-30", "2026-13-99", "10/08/2026", ""]) expect(() => parseAsOf(["--as-of", bad])).toThrow("--as-of must be");
    expect(() => parseAsOf(["--as-of"])).toThrow("--as-of must be");
  });
});

describe("datedFiles", () => {
  const names = ["2026-10-08.json", "2026-10-06.json", "2026-10-09.json", "notes.txt", "2026-10-05.json.tmp", "2026-02-30.json", "2026-09-01.json"];

  it("returns the dated files up to as-of, newest first (current, then previous)", () => {
    expect(datedFiles(names, "2026-10-08")).toEqual(["2026-10-08.json", "2026-10-06.json", "2026-09-01.json"]);
    expect(datedFiles(names, "2026-10-07")).toEqual(["2026-10-06.json", "2026-09-01.json"]);
  });

  it("returns nothing when no file is dated on or before as-of", () => {
    expect(datedFiles(names, "2020-01-01")).toEqual([]);
    expect(datedFiles([], "2026-10-08")).toEqual([]);
  });
});

describe("selectors", () => {
  it("finds a row by code and issuer", () => {
    const rows = [row()];
    expect(rowFor(rows, "BB1", row().issuer)).toBe(rows[0]);
    expect(rowFor([row()], "BB1", "GOTHER")).toBeUndefined();
  });

  it("tags an asset's examination checks with their file", () => {
    const out = examChecksFor([check(), check({ asset: "X:G" })], KEY, "data/examinations/2026-10-08.json");
    expect(out).toHaveLength(1);
    expect(out[0].file).toBe("data/examinations/2026-10-08.json");
  });
});
