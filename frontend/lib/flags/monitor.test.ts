import { describe, expect, it } from "vitest";
import { flagLargeMintBurn, flagPriceDeviation, type MintBurnInput, type PriceInput } from "./monitor";

const REF = "data/monitor/issuance/2026-10-08.json#BB1:GD5J";
const TODAY = "2026-10-08"; // window: 2026-10-01 .. 2026-10-07
const WINDOW = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07"];
const quiet = (date: string) => ({ date, minted: "0.0000000", burned: "0.0000000", supply_end: "1000.0000000" });
const full = (over: Record<string, Partial<ReturnType<typeof quiet>>> = {}, extra: Partial<MintBurnInput> = {}): MintBurnInput => ({
  supply: "1000.0000000", days: WINDOW.map((d) => ({ ...quiet(d), ...over[d] })), missing: [], ref: REF, ...extra,
});
const raisedText = (e: ReturnType<typeof flagLargeMintBurn>) => (e.outcome === "raised" ? e.statement : e.outcome === "clear" ? e.reason : e.reason);

describe("flagLargeMintBurn (flags-v4)", () => {
  it("is not evaluated without Monitor data, or without a current chain check day", () => {
    expect(flagLargeMintBurn(null, TODAY)).toEqual({ flag: "LARGE_MINT_BURN", outcome: "not_evaluated", reason: "No daily issuance data from the Monitor for this asset." });
    expect(flagLargeMintBurn(full(), null)).toEqual({ flag: "LARGE_MINT_BURN", outcome: "not_evaluated", reason: "No current chain check to anchor the 7-day window." });
  });

  it("is clear when seven complete quiet days are in the window, with the exact reason and evidence", () => {
    expect(flagLargeMintBurn(full(), TODAY)).toEqual({
      flag: "LARGE_MINT_BURN", outcome: "clear", as_of: TODAY, evidence: [{ kind: "chain_check", ref: REF }],
      reason: "No single day from 2026-10-01 to 2026-10-07 minted or burned more than 20% of supply.",
    });
  });

  it("exactly 20% is not large and just above is, for mints", () => {
    // supply_end 1000, minted 200 -> start 800, base 1000
    expect(flagLargeMintBurn(full({ "2026-10-05": { minted: "200.0000000" } }), TODAY).outcome).toBe("clear");
    const e = flagLargeMintBurn(full({ "2026-10-05": { minted: "200.0000001" } }), TODAY);
    expect(e.outcome).toBe("raised");
  });

  it("uses the larger of the start and end supply as the base, so burns are compared with the supply before them", () => {
    // end 800, burned 200 -> start 1000, base 1000: exactly 20% -> clear
    expect(flagLargeMintBurn(full({ "2026-10-05": { burned: "200.0000000", supply_end: "800.0000000" } }), TODAY).outcome).toBe("clear");
    const e = flagLargeMintBurn(full({ "2026-10-05": { burned: "210.0000000", supply_end: "790.0000000" } }), TODAY);
    expect(e).toEqual({
      flag: "LARGE_MINT_BURN", outcome: "raised", severity: "WARNING", as_of: TODAY, evidence: [{ kind: "chain_check", ref: `${REF}#2026-10-05` }],
      statement: "Single-day burn of 210 on 2026-10-05 is 21% of supply (1000); no matching document is checked in v1. Held through 2026-10-12.",
    });
  });

  it("holds 7 days after the large day and ignores it on the 8th (wholeDays 7 raised, 8 not in the window)", () => {
    const big = { minted: "300.0000000", supply_end: "1000.0000000" };
    const input = (largeDate: string) => ({ supply: "1000.0000000", days: [...WINDOW, "2026-09-30"].map((d) => ({ ...quiet(d), ...(d === largeDate ? big : {}) })), missing: [], ref: REF });
    // current day 2026-10-08: 2026-10-01 is 7 days before -> raised; 2026-09-30 is 8 days before -> outside the window
    expect(flagLargeMintBurn(input("2026-10-01"), TODAY).outcome).toBe("raised");
    expect(flagLargeMintBurn(input("2026-09-30"), TODAY).outcome).toBe("clear");
    // the current day itself is not in the window (wholeDays 0)
    expect(flagLargeMintBurn({ ...full(), days: [...full().days, { ...quiet(TODAY), ...big }] }, TODAY).outcome).toBe("clear");
  });

  it("names the largest day by share", () => {
    const e = flagLargeMintBurn(full({ "2026-10-02": { minted: "300.0000000" }, "2026-10-03": { minted: "500.0000000" } }), TODAY);
    expect(raisedText(e)).toContain("mint of 500 on 2026-10-03");
  });

  it("a raised day beats a missing day elsewhere in the window", () => {
    const input = full({ "2026-10-05": { minted: "300.0000000" } }, { missing: ["2026-10-02"] });
    input.days = input.days.filter((d) => d.date !== "2026-10-02");
    expect(flagLargeMintBurn(input, TODAY).outcome).toBe("raised");
  });

  it("is not evaluated, never clear, when a day is absent or listed as missing, and names the dates", () => {
    const absent = full();
    absent.days = absent.days.filter((d) => d.date !== "2026-10-03");
    expect(flagLargeMintBurn(absent, TODAY)).toEqual({
      flag: "LARGE_MINT_BURN", outcome: "not_evaluated",
      reason: "Daily issuance data is missing or does not reconcile with on-chain supply for 2026-10-03.",
    });
    const listed = full({}, { missing: ["2026-10-06", "2026-10-02"] });
    expect(raisedText(flagLargeMintBurn(listed, TODAY))).toBe("Daily issuance data is missing or does not reconcile with on-chain supply for 2026-10-02, 2026-10-06.");
    expect(flagLargeMintBurn({ supply: "1.0000000", days: [], missing: [] }, TODAY).outcome).toBe("not_evaluated");
  });

  it("skips a day with a zero base and has no evidence when the input carries no reference", () => {
    const input = full({ "2026-10-04": { supply_end: "0.0000000" } });
    delete input.ref;
    const e = flagLargeMintBurn(input, TODAY);
    expect(e).toMatchObject({ outcome: "clear", evidence: [] });
  });

  it("uses plain facts: no banned wording in any outcome", () => {
    const texts = [flagLargeMintBurn(full(), TODAY), flagLargeMintBurn(full({ "2026-10-05": { minted: "900.0000000" } }), TODAY), flagLargeMintBurn(null, TODAY)].map(raisedText);
    for (const t of texts) expect(t).not.toMatch(/fraud|scam|unsafe|grade|rating|score|price/i);
  });
});

describe("flagPriceDeviation", () => {
  const input = (over: Partial<PriceInput> = {}): PriceInput => ({
    market_price: 1.02, market_source: "SDEX", market_as_of: "2026-10-08", nav_per_unit: 1, nav_source: "N-MFP3 filed 2026-09-04", nav_as_of: "2026-08-31", currency_match: true, ...over,
  });

  it("is not evaluated without inputs, with a currency mismatch, or a non-positive NAV", () => {
    expect(flagPriceDeviation(null).outcome).toBe("not_evaluated");
    expect(flagPriceDeviation(input({ currency_match: false })).outcome).toBe("not_evaluated");
    expect(flagPriceDeviation(input({ nav_per_unit: 0 })).outcome).toBe("not_evaluated");
    expect(flagPriceDeviation(input({ nav_per_unit: -1 })).outcome).toBe("not_evaluated");
  });

  it("is clear at exactly 2% and raised above it, in either direction", () => {
    expect(flagPriceDeviation(input()).outcome).toBe("clear");
    expect(flagPriceDeviation(input({ market_price: 0.98 })).outcome).toBe("clear");
    const up = flagPriceDeviation(input({ market_price: 1.0201 }));
    expect(up).toMatchObject({ outcome: "raised", severity: "WARNING" });
    expect(up.outcome === "raised" && up.statement).toBe("Market price 1.0201 (SDEX, 2026-10-08) differs from NAV per unit 1 (N-MFP3 filed 2026-09-04, 2026-08-31) by 2.01%.");
    expect(flagPriceDeviation(input({ market_price: 0.97 })).outcome).toBe("raised");
  });
});
