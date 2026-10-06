import { describe, expect, it } from "vitest";
import type { ProposedClaim } from "./fields";
import { findQuote, normalizeForMatch, pageAt, verifyClaim } from "./verify";

const TEXT = [
  "Franklin OnChain U.S. Government Money Fund",
  "As of August 31, 2026, the Fund’s net assets were $522,773,589.63.",
  "\f",
  "One BENJI token corresponds to one share of the Fund.",
  "WTGX: WisdomTree Government Money Market Digital Fund",
  "The custodian is The Bank of New York Mellon.",
].join("\n");

const claim = (overrides: Partial<ProposedClaim>): ProposedClaim => ({
  field: "net_assets",
  asset_code: "BENJI",
  value_text: "$522,773,589.63",
  unit: "USD",
  as_of_text: "August 31, 2026",
  quote: "As of August 31, 2026, the Fund's net assets were $522,773,589.63.",
  page: 7,
  ...overrides,
});

const verify = (c: ProposedClaim, assets = [{ code: "BENJI" }]) =>
  verifyClaim({ claim: c, text: TEXT, normalized: normalizeForMatch(TEXT), isPdf: true, assets });

describe("verifyClaim", () => {
  it("accepts a verbatim quote (typographic apostrophe and spacing normalized) and computes the page", () => {
    const r = verify(claim({ quote: "As of  August 31, 2026, the Fund's net assets\nwere $522,773,589.63." }));
    expect(r).toEqual({ ok: true, result: { value: 522773589.63, as_of: "2026-08-31", page: 1 } });
  });

  it("drops a quote that is not in the document", () => {
    expect(verify(claim({ quote: "As of August 31, 2026, the Fund's net assets were $600,000,000.00." }))).toEqual({ ok: false, reason: "quote_not_found" });
  });

  it("drops a real quote paired with a value that is not in it", () => {
    expect(verify(claim({ value_text: "$600,000,000" }))).toEqual({ ok: false, reason: "value_not_in_quote" });
  });

  it("drops an as-of date that is not in the quote", () => {
    expect(verify(claim({ as_of_text: "September 30, 2026" }))).toEqual({ ok: false, reason: "as_of_not_in_quote" });
  });

  it("drops values code cannot parse and quotes that are too short", () => {
    expect(verify(claim({ field: "report_date", value_text: "August", as_of_text: null }))).toEqual({ ok: false, reason: "value_unparseable" });
    expect(verify(claim({ quote: "net assets", value_text: "net" }))).toEqual({ ok: false, reason: "quote_too_short" });
  });

  it("computes the page from the match, ignoring the page the model gave", () => {
    const r = verify(claim({ field: "token_unit_ratio", value_text: "one", quote: "One BENJI token corresponds to one share of the Fund.", as_of_text: null, page: 1 }));
    expect(r.ok).toBe(false); // "one" is not a number code can parse
    const r2 = verify(claim({ field: "custodian", value_text: "The Bank of New York Mellon", quote: "The custodian is The Bank of New York Mellon.", as_of_text: null, page: 1 }));
    expect(r2).toEqual({ ok: true, result: { value: "The Bank of New York Mellon", as_of: null, page: 2 } });
  });

  it("in multi-asset documents, requires the asset code or name near the quote", () => {
    const assets = [{ code: "BENJI" }, { code: "WTGX", name: "WisdomTree Government Money Market Digital Fund" }, { code: "WTSY" }];
    const custodian = { field: "custodian" as const, value_text: "The Bank of New York Mellon", quote: "The custodian is The Bank of New York Mellon.", as_of_text: null };
    expect(verify(claim({ ...custodian, asset_code: "WTGX" }), assets).ok).toBe(true);
    expect(verify(claim({ ...custodian, asset_code: "WTSY" }), assets)).toEqual({ ok: false, reason: "attribution_unverified" });
    expect(verify(claim({ ...custodian, asset_code: "ISSUER" }), assets).ok).toBe(true);
  });
});

describe("matching helpers", () => {
  it("maps normalized offsets back to the source text", () => {
    const doc = normalizeForMatch("A  “quoted”\n—text");
    expect(doc.value).toBe('a "quoted" -text');
    expect(findQuote(doc, '"QUOTED" -text')).toBe(3);
    expect(findQuote(doc, "missing")).toBeNull();
  });

  it("counts pages only for PDFs", () => {
    expect(pageAt("a\fb\fc", 4, true)).toBe(3);
    expect(pageAt("a\fb", 0, true)).toBe(1);
    expect(pageAt("a\fb", 2, false)).toBeNull();
  });
});
