import type { PaymentRequirements } from "@x402/core/types";
import { describe, expect, it } from "vitest";
import { NETWORK, USDC_TESTNET_SAC } from "../gateway/payment-config";
import { PAY_TO, SENTINEL_AMOUNT } from "../gateway/testkit";
import { acceptRequirements, baseToDecimal, decimalToBase, refuseReason, refusePayer } from "./policy";

const expected = { payTo: PAY_TO, capBase: BigInt(SENTINEL_AMOUNT) };
const good: PaymentRequirements = {
  scheme: "exact",
  network: NETWORK,
  asset: USDC_TESTNET_SAC,
  amount: SENTINEL_AMOUNT,
  payTo: PAY_TO,
  maxTimeoutSeconds: 60,
  extra: { areFeesSponsored: true },
};
const OTHER = "GD436PARIAIVGQMI4O54RRKGBL6H7T3BPPKFSTYQGSG3727SXRCGE4S4";

describe("refuseReason / acceptRequirements (L1)", () => {
  it("accepts exactly the expected testnet payment, up to the cap", () => {
    expect(refuseReason(2, good, expected)).toBeNull();
    expect(refuseReason(2, { ...good, amount: String(BigInt(SENTINEL_AMOUNT) - 1n) }, expected)).toBeNull();
    expect(acceptRequirements(expected)(2, [good])).toEqual([good]);
  });

  it("refuses a wrong network, asset, payee, scheme, or version", () => {
    expect(refuseReason(2, { ...good, network: "stellar:pubnet" }, expected)).toMatch(/network/);
    expect(refuseReason(2, { ...good, network: "eip155:8453" }, expected)).toMatch(/network/);
    expect(refuseReason(2, { ...good, asset: OTHER }, expected)).toMatch(/asset/);
    expect(refuseReason(2, { ...good, payTo: OTHER }, expected)).toMatch(/payTo/);
    expect(refuseReason(2, { ...good, scheme: "upto" }, expected)).toMatch(/scheme/);
    expect(refuseReason(1, good, expected)).toMatch(/version/);
  });

  it("refuses when fees are not sponsored or the flag is missing", () => {
    expect(refuseReason(2, { ...good, extra: { areFeesSponsored: false } }, expected)).toMatch(/sponsor/);
    expect(refuseReason(2, { ...good, extra: {} }, expected)).toMatch(/sponsor/);
  });

  it("refuses an amount above the cap, zero, or not an integer; the reason repeats no amount", () => {
    const above = refuseReason(2, { ...good, amount: String(BigInt(SENTINEL_AMOUNT) + 1n) }, expected);
    expect(above).toMatch(/above the cap/);
    expect(above).not.toContain(SENTINEL_AMOUNT);
    for (const amount of ["0", "-1", "1.5", "abc", "", "01"]) expect(refuseReason(2, { ...good, amount }, expected), amount).toMatch(/amount/);
  });

  it("filters a list down to the acceptable requirements", () => {
    const bad = { ...good, network: "stellar:pubnet" as const };
    expect(acceptRequirements(expected)(2, [bad, good])).toEqual([good]);
    expect(acceptRequirements(expected)(2, [bad])).toEqual([]);
  });
});

describe("amount conversion (L3)", () => {
  it("round-trips base units and 7-place decimals exactly", () => {
    for (const base of [0n, 1n, 4242n, 10_000_000n, 123_456_789_012_345_678n]) expect(decimalToBase(baseToDecimal(base))).toBe(base);
    expect(baseToDecimal(BigInt(SENTINEL_AMOUNT))).toBe("0.0004242");
    expect(decimalToBase("0.0004242")).toBe(BigInt(SENTINEL_AMOUNT));
    expect(decimalToBase("12")).toBe(120_000_000n);
    expect(decimalToBase("1.5")).toBe(15_000_000n);
  });

  it("refuses anything that is not a plain decimal with up to 7 places", () => {
    for (const bad of ["", "1.", ".5", "-1", "1e3", "1.12345678", "0x10", " 1"]) expect(() => decimalToBase(bad), bad).toThrow();
    expect(() => baseToDecimal(-1n)).toThrow();
  });
});

describe("refusePayer (L4)", () => {
  const roles = { publisher: "GPUB", admin: "GADM", payTo: "GRCV" };
  it("refuses the publisher, the admin, and the receiver", () => {
    expect(refusePayer({ ...roles, payer: "GPUB" })).toMatch(/publisher/);
    expect(refusePayer({ ...roles, payer: "GADM" })).toMatch(/admin/);
    expect(refusePayer({ ...roles, payer: "GRCV" })).toMatch(/receiving/);
  });
  it("allows any other account", () => {
    expect(refusePayer({ ...roles, payer: "GPAY" })).toBeNull();
  });
});
