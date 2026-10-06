import { describe, expect, it } from "vitest";
import type { ProposedClaim } from "./fields";
import { currencyAround, findQuoteOffsets, findToken, normalizeForMatch, pageAt, verifyClaim, type VerifyContext } from "./verify";

const TEXT = [
  "Franklin OnChain U.S. Government Money Fund",
  "As of August 31, 2026, the Fund’s net assets were $522,773,589.63.",
  "\f",
  "Total net assets of the BB1 program were $1.2 billion as of June 30, 2026.",
  "WTGX: WisdomTree Government Money Market Digital Fund",
  "The custodian is The Bank of New York Mellon.",
  "WTSY: WisdomTree Short-Term Treasury Digital Fund",
  "Its net assets were $10,000,000 as of June 30, 2026.",
  "Partners: FireblocksTokuStellar",
].join("\n");

const ctx = (overrides: Partial<VerifyContext> = {}): VerifyContext => ({
  text: TEXT,
  normalized: normalizeForMatch(TEXT),
  isPdf: true,
  locale: "en",
  assets: [{ code: "BENJI" }],
  dedicated: true,
  ...overrides,
});

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

describe("verifyClaim", () => {
  it("accepts a verbatim quote, parses the document's own characters, and computes page and currency", () => {
    const r = verifyClaim(claim({ quote: "As of  August 31, 2026, the Fund's net assets\nwere $522,773,589.63." }), ctx());
    expect(r).toEqual({
      ok: true,
      result: { value: 522773589.63, value_text: "$522,773,589.63", unit: "USD", as_of: "2026-08-31", page: 1 },
    });
  });

  it("is case-sensitive", () => {
    expect(verifyClaim(claim({ quote: "as of august 31, 2026, the fund's net assets were $522,773,589.63." }), ctx())).toEqual({ ok: false, reason: "quote_not_found" });
  });

  it("drops quotes that are missing, ambiguous, or too short", () => {
    expect(verifyClaim(claim({ quote: "As of August 31, 2026, the Fund's net assets were $600,000,000.00." }), ctx()).ok).toBe(false);
    expect(verifyClaim(claim({ quote: "net assets were", value_text: "net" }), ctx())).toEqual({ ok: false, reason: "quote_too_short" });
    expect(verifyClaim(claim({ quote: "as of June 30, 2026.", value_text: "June 30, 2026", field: "report_date", as_of_text: null }), ctx())).toEqual({ ok: false, reason: "quote_ambiguous" });
  });

  it("only matches the value as a whole token", () => {
    const quote = "Total net assets of the BB1 program were $1.2 billion as of June 30, 2026.";
    expect(verifyClaim(claim({ quote, value_text: "1", as_of_text: null, asset_code: "BENJI" }), ctx()).ok).toBe(false);
    expect(verifyClaim(claim({ quote: "As of August 31, 2026, the Fund's net assets were $522,773,589.63.", value_text: "773,589.63" }), ctx())).toEqual({ ok: false, reason: "value_not_in_quote" });
    const logo = "Partners: FireblocksTokuStellar";
    expect(verifyClaim(claim({ field: "networks", quote: logo, value_text: "Stellar", as_of_text: null }), ctx())).toEqual({ ok: false, reason: "value_not_in_quote" });
  });

  it("drops an amount that leaves out its scale word", () => {
    const quote = "Total net assets of the BB1 program were $1.2 billion as of June 30, 2026.";
    expect(verifyClaim(claim({ quote, value_text: "$1.2", as_of_text: null }), ctx())).toEqual({ ok: false, reason: "value_scale_omitted" });
    const r = verifyClaim(claim({ quote, value_text: "$1.2 billion", as_of_text: "June 30, 2026" }), ctx());
    expect(r.ok && r.result.value).toBe(1_200_000_000);
  });

  it("refuses quotes that do not read like the field", () => {
    const quote = "As of August 31, 2026, the Fund's net assets were $522,773,589.63.";
    expect(verifyClaim(claim({ quote, field: "custodian", value_text: "Fund", as_of_text: null }), ctx())).toEqual({ ok: false, reason: "field_gate" });
  });

  it("attributes by the closest preceding asset mention unless the document is dedicated", () => {
    const assets = [{ code: "WTGX", name: "WisdomTree Government Money Market Digital Fund" }, { code: "WTSY" }];
    const wtsy = { quote: "Its net assets were $10,000,000 as of June 30, 2026.", value_text: "$10,000,000", as_of_text: "June 30, 2026" };
    const multi = ctx({ assets, dedicated: false });
    expect(verifyClaim(claim({ ...wtsy, asset_code: "WTSY" }), multi).ok).toBe(true);
    expect(verifyClaim(claim({ ...wtsy, asset_code: "WTGX" }), multi)).toEqual({ ok: false, reason: "attribution_unverified" });
    // Single-asset but not dedicated (e.g. a homepage): the code must still be mentioned before the quote.
    const homepage = ctx({ assets: [{ code: "USDY" }], dedicated: false });
    expect(verifyClaim(claim({ ...wtsy, asset_code: "USDY" }), homepage)).toEqual({ ok: false, reason: "attribution_unverified" });
  });

  it("ignores asset mentions after the quote", () => {
    const text = "Net assets were $5,000,000 as of June 30, 2026.\nWTSY section starts here.";
    const c = ctx({ text, normalized: normalizeForMatch(text), assets: [{ code: "WTGX" }, { code: "WTSY" }], dedicated: false });
    expect(verifyClaim(claim({ quote: "Net assets were $5,000,000 as of June 30, 2026.", value_text: "$5,000,000", as_of_text: null, asset_code: "WTSY" }), c)).toEqual({
      ok: false,
      reason: "attribution_unverified",
    });
  });
});

describe("matching helpers", () => {
  it("normalizes whitespace, quotes, dashes, and ligatures but keeps case and digits", () => {
    const doc = normalizeForMatch("A  “quoted”\n—text ﬁnal 100¹");
    expect(doc.value).toBe('A "quoted" -text final 100¹');
    expect(findQuoteOffsets(doc, '"quoted" -text')).toEqual([2]);
    expect(findQuoteOffsets(doc, "1001")).toEqual([]);
  });

  it("finds whole tokens only", () => {
    expect(findToken("the BB1 token", "1")).toBe(-1);
    expect(findToken("$1,234,567", "234,567")).toBe(-1);
    expect(findToken("$5.75 million", "$5")).toBe(-1);
    expect(findToken("is 1 token", "1")).toBe(3);
  });

  it("reads currency from the document around the value", () => {
    const t = "worth $5 or EUR 7 or A$ 9 or 11";
    expect(currencyAround(t, 6, 8)).toBe("USD");
    expect(currencyAround(t, 16, 17)).toBe("EUR");
    expect(currencyAround(t, 24, 25)).toBeNull();
    expect(currencyAround(t, 29, 31)).toBeNull();
  });

  it("counts pages only for PDFs", () => {
    expect(pageAt("a\fb\fc", 4, true)).toBe(3);
    expect(pageAt("a\fb", 0, true)).toBe(1);
    expect(pageAt("a\fb", 2, false)).toBeNull();
  });
});
