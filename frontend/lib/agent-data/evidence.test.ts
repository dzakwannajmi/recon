import { describe, expect, it } from "vitest";
import { paymentConfig } from "@/lib/gateway/payment-config";
import { asset, statusFile } from "@/lib/factsheet/fixtures";
import { paidDetailAvailable, projectEvidenceOffer } from "./evidence";

const G = "GBHNGLLIE3KWGKCHIKMHJ5HVZHYIK7WTBE4QF5PLAKL4CJGSEU7HZIW5";
const ON = { X402_ENABLED: "true", X402_PAY_TO: G, X402_TESTNET_AMOUNT: "100" };

describe("paidDetailAvailable agrees with paymentConfig(env).ok", () => {
  const cases: Record<string, Record<string, string | undefined>> = {
    empty: {},
    on: ON,
    "enabled false": { ...ON, X402_ENABLED: "false" },
    "pricing on": { ...ON, PRICING_ENABLED: "true" },
    "pricing false": { ...ON, PRICING_ENABLED: "false" },
    "mainnet network": { ...ON, X402_NETWORK: "stellar:pubnet" },
    "testnet network": { ...ON, X402_NETWORK: "stellar:testnet" },
    "pay_to secret": { ...ON, X402_PAY_TO: "S" + "A".repeat(55) },
    "pay_to bad": { ...ON, X402_PAY_TO: "nope" },
    "amount zero": { ...ON, X402_TESTNET_AMOUNT: "0" },
    "amount word": { ...ON, X402_TESTNET_AMOUNT: "ten" },
    "facilitator http": { ...ON, X402_FACILITATOR_URL: "http://x402.org/facilitator" },
    "facilitator other host": { ...ON, X402_FACILITATOR_URL: "https://evil.example/f" },
    "facilitator allowed host": { ...ON, X402_FACILITATOR_URL: "https://f.example/f", X402_FACILITATOR_ALLOW_HOSTS: "f.example" },
    "facilitator creds": { ...ON, X402_FACILITATOR_URL: "https://u:p@x402.org/f" },
    "facilitator garbage": { ...ON, X402_FACILITATOR_URL: "not a url" },
  };
  for (const [name, env] of Object.entries(cases)) {
    it(name, () => expect(paidDetailAvailable(env)).toBe(paymentConfig(env).ok));
  }
});

describe("projectEvidenceOffer", () => {
  const one = asset({ asset: `AAA:${G}`, asset_code: "AAA", issuer: G, status: "OK" });
  const status = statusFile([one]);

  it("is not available when the paid switch is off, and says nothing else", () => {
    const out = projectEvidenceOffer(status, "AAA", undefined, false);
    expect(out).toMatchObject({ premium: true, available: false, detail_path: null });
  });

  it("offers the detail path for a unique published asset, with no evidence in the result", () => {
    const out = projectEvidenceOffer(status, "AAA", undefined, true);
    expect(out).toMatchObject({ premium: true, available: true, asset_code: "AAA", issuer: G, detail_path: `/api/check/detail?asset_code=AAA&issuer=${G}` });
    const text = JSON.stringify(out);
    expect(Object.keys(out).sort()).toEqual(["asset_code", "available", "detail_path", "issuer", "note", "premium"]);
    expect(text).not.toMatch(/quote|snapshot_sha256|evidence_hash|raised|schema/);
    expect(out.note).toMatch(/cannot pay/);
  });

  it("is not available for an unknown code, a wrong issuer, a missing status file, or an unpublished asset", () => {
    expect(projectEvidenceOffer(status, "ZZZ", undefined, true).available).toBe(false);
    expect(projectEvidenceOffer(status, "AAA", "GCRYUGD5NVARGXT56XEZI5CIFCQETYHAPQQTHO2O3IQZTHDH4LATMYWC", true).available).toBe(false);
    expect(projectEvidenceOffer(null, "AAA", undefined, true).available).toBe(false);
    expect(projectEvidenceOffer(statusFile([{ ...one, status: null } as never]), "AAA", undefined, true).available).toBe(false);
  });

  it("asks for an issuer when the code is ambiguous", () => {
    const other = asset({ asset: `AAA:GCRYUGD5NVARGXT56XEZI5CIFCQETYHAPQQTHO2O3IQZTHDH4LATMYWC`, asset_code: "AAA", issuer: "GCRYUGD5NVARGXT56XEZI5CIFCQETYHAPQQTHO2O3IQZTHDH4LATMYWC" });
    const out = projectEvidenceOffer(statusFile([one, other]), "AAA", undefined, true);
    expect(out.available).toBe(false);
    expect(out.note).toMatch(/issuer/);
  });
});
