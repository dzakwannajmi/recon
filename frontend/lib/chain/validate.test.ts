import { describe, expect, it } from "vitest";
import { isAccountId, isAssetCode } from "./validate";

const ISSUER = "GBHNGLLIE3KWGKCHIKMHJ5HVZHYIK7WTBE4QF5PLAKL4CJGSEU7HZIW5";

describe("validate", () => {
  it("accepts asset codes of 1-12 letters or digits", () => {
    expect(isAssetCode("BENJI")).toBe(true);
    expect(isAssetCode("sgBENJI")).toBe(true);
    expect(isAssetCode("")).toBe(false);
    expect(isAssetCode("TOO_LONG_CODE_X")).toBe(false);
    expect(isAssetCode(42)).toBe(false);
  });

  it("accepts only account IDs with a valid checksum", () => {
    expect(isAccountId(ISSUER)).toBe(true);
    expect(isAccountId(ISSUER.slice(0, -1) + (ISSUER.endsWith("5") ? "6" : "5"))).toBe(false);
    expect(isAccountId("G" + "A".repeat(55))).toBe(false);
    expect(isAccountId("SBHNGLLIE3KWGKCHIKMHJ5HVZHYIK7WTBE4QF5PLAKL4CJGSEU7HZIW5")).toBe(false);
    expect(isAccountId(undefined)).toBe(false);
  });
});
