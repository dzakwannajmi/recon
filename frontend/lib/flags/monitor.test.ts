import { describe, expect, it } from "vitest";
import { flagLargeMintBurn, flagPriceDeviation, type PriceInput } from "./monitor";

const day = (over = {}) => ({ date: "2026-10-01", minted: "0", burned: "0", supply_end: "1000", ...over });

describe("flagLargeMintBurn", () => {
  it("is not evaluated without Monitor data", () => {
    expect(flagLargeMintBurn(null)).toMatchObject({ outcome: "not_evaluated", reason: "Needs daily issuance data from the Monitor (W4.1)" });
    expect(flagLargeMintBurn({ supply: "1000", days: [] }).outcome).toBe("not_evaluated");
  });

  it("is clear at exactly 20% and raised just above, for mints", () => {
    // supply_end 1000, minted 200 -> start 800, base 1000, 20%
    expect(flagLargeMintBurn({ supply: "1000", days: [day({ minted: "200" })] }).outcome).toBe("clear");
    const e = flagLargeMintBurn({ supply: "1000", days: [day({ minted: "200.0000001" })] });
    expect(e.outcome).toBe("raised");
  });

  it("uses the larger of the start and end supply as the base, so burns are compared with the supply before them", () => {
    // end 800, burned 200 -> start 1000, base 1000: exactly 20% -> clear
    expect(flagLargeMintBurn({ supply: "800", days: [day({ burned: "200", supply_end: "800" })] }).outcome).toBe("clear");
    const e = flagLargeMintBurn({ supply: "790", days: [day({ burned: "210", supply_end: "790" })] });
    expect(e).toMatchObject({ outcome: "raised", severity: "WARNING", as_of: "2026-10-01" });
    expect(e.outcome === "raised" && e.statement).toBe("Single-day burn of 210 on 2026-10-01 is 21% of supply (1000); no matching document is checked in v1.");
  });

  it("names the largest day and skips days with a zero base", () => {
    const e = flagLargeMintBurn({
      supply: "1000",
      days: [day({ date: "2026-10-01", minted: "300" }), day({ date: "2026-10-02", minted: "500" }), { date: "2026-10-03", minted: "0", burned: "0", supply_end: "0" }],
    });
    expect(e.outcome === "raised" && e.statement).toContain("mint of 500 on 2026-10-02");
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
