import { Keypair } from "@stellar/stellar-sdk";
import { USDC_TESTNET_ADDRESS } from "@x402/stellar";
import { describe, expect, it } from "vitest";
import { USDC_TESTNET_SAC, paymentConfig, pinnedAssetMatchesPackage } from "./payment-config";
import { PAY_TO, SENTINEL_AMOUNT } from "./testkit";

const base = { X402_ENABLED: "true", X402_PAY_TO: PAY_TO, X402_TESTNET_AMOUNT: SENTINEL_AMOUNT };
const reason = (env: Record<string, string | undefined>) => {
  const r = paymentConfig(env);
  return r.ok ? "ok" : r.reason;
};

describe("paymentConfig", () => {
  it("C1: a complete testnet configuration is ok, with the facilitator default and no trailing slash", () => {
    expect(paymentConfig(base)).toEqual({ ok: true, config: { payTo: PAY_TO, amount: SENTINEL_AMOUNT, facilitatorUrl: "https://x402.org/facilitator" } });
    const withUrl = paymentConfig({ ...base, X402_FACILITATOR_URL: "https://www.x402.org/facilitator/" });
    expect(withUrl).toMatchObject({ ok: true, config: { facilitatorUrl: "https://www.x402.org/facilitator" } });
  });

  it("C2: PRICING_ENABLED other than unset, empty, or false closes the route", () => {
    expect(reason({ ...base, PRICING_ENABLED: "true" })).toBe("pricing_enabled_not_supported");
    expect(reason({ ...base, PRICING_ENABLED: "1" })).toBe("pricing_enabled_not_supported");
    expect(reason({ ...base, PRICING_ENABLED: "false" })).toBe("ok");
    expect(reason({ ...base, PRICING_ENABLED: "" })).toBe("ok");
  });

  it("C3: X402_ENABLED must be exactly true", () => {
    expect(reason({ ...base, X402_ENABLED: undefined })).toBe("disabled");
    expect(reason({ ...base, X402_ENABLED: "" })).toBe("disabled");
    expect(reason({ ...base, X402_ENABLED: "TRUE" })).toBe("disabled");
    expect(reason({ ...base, X402_ENABLED: "1" })).toBe("disabled");
  });

  it("C4: only stellar:testnet is accepted", () => {
    expect(reason({ ...base, X402_NETWORK: "stellar:pubnet" })).toBe("network_not_testnet");
    expect(reason({ ...base, X402_NETWORK: "stellar:*" })).toBe("network_not_testnet");
    expect(reason({ ...base, X402_NETWORK: "stellar:testnet" })).toBe("ok");
  });

  it("C5: a secret seed or a bad address in X402_PAY_TO is refused, and the reason names no value", () => {
    const secret = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7)).secret();
    const r = paymentConfig({ ...base, X402_PAY_TO: secret });
    expect(r).toEqual({ ok: false, reason: "pay_to_is_secret" });
    expect(JSON.stringify(r)).not.toContain(secret.slice(1, 10));
    expect(reason({ ...base, X402_PAY_TO: "GABC" })).toBe("pay_to_invalid");
    expect(reason({ ...base, X402_PAY_TO: undefined })).toBe("pay_to_invalid");
    expect(reason({ ...base, X402_PAY_TO: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA" })).toBe("pay_to_invalid");
  });

  it("C6: the amount must be a positive integer of base units, and a failure does not echo it", () => {
    for (const bad of [undefined, "", "0", "01", "-5", "1.5", "1e3", "abc", "1".repeat(13)]) expect(reason({ ...base, X402_TESTNET_AMOUNT: bad }), String(bad)).toBe("amount_invalid");
    expect(reason({ ...base, X402_TESTNET_AMOUNT: "9".repeat(12) })).toBe("ok");
    expect(JSON.stringify(paymentConfig({ ...base, X402_TESTNET_AMOUNT: "0" }))).not.toContain(SENTINEL_AMOUNT);
  });

  it("C7: the facilitator must be https on x402.org or an allowed host", () => {
    expect(reason({ ...base, X402_FACILITATOR_URL: "http://x402.org/facilitator" })).toBe("facilitator_url_invalid");
    expect(reason({ ...base, X402_FACILITATOR_URL: "not a url" })).toBe("facilitator_url_invalid");
    expect(reason({ ...base, X402_FACILITATOR_URL: "https://user:pw@x402.org/facilitator" })).toBe("facilitator_url_invalid");
    expect(reason({ ...base, X402_FACILITATOR_URL: "https://evil.example/facilitator" })).toBe("facilitator_host_not_allowed");
    expect(reason({ ...base, X402_FACILITATOR_URL: "https://x402.org.evil.example/facilitator" })).toBe("facilitator_host_not_allowed");
    expect(reason({ ...base, X402_FACILITATOR_URL: "https://fac.example.org/x", X402_FACILITATOR_ALLOW_HOSTS: "other.example, FAC.example.org" })).toBe("ok");
  });

  it("pins the testnet USDC contract and checks it against the installed package", () => {
    expect(USDC_TESTNET_SAC).toBe(USDC_TESTNET_ADDRESS);
    expect(pinnedAssetMatchesPackage()).toBe(true);
    expect(paymentConfig(base, () => false)).toEqual({ ok: false, reason: "asset_constant_mismatch" });
  });
});
