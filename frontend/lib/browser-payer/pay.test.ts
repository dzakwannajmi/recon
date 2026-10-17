import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it, vi } from "vitest";
import { NETWORK, USDC_TESTNET_SAC } from "./constants";
import { payForDetail } from "./pay";
import { burnerKey } from "./storage";

// The real scheme simulates a Soroban transaction over the network; a fake one signs nothing and sends nothing.
vi.mock("@x402/stellar/exact/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("@x402/stellar/exact/client")>();
  return {
    ...real,
    ExactStellarScheme: class extends real.ExactStellarScheme {
      override async createPaymentPayload() {
        return { x402Version: 2, payload: { transaction: "AAAA" } } as never;
      }
    },
  };
});

const PAY_TO = "GBHNGLLIE3KWGKCHIKMHJ5HVZHYIK7WTBE4QF5PLAKL4CJGSEU7HZIW5";
const required = {
  x402Version: 2,
  resource: { url: "http://localhost/api/check/detail" },
  accepts: [{ scheme: "exact", network: NETWORK, asset: USDC_TESTNET_SAC, amount: "5", payTo: PAY_TO, maxTimeoutSeconds: 60, extra: { areFeesSponsored: true } }],
};
const unpaid = () =>
  new Response(JSON.stringify({ error: "payment_required" }), { status: 402, headers: { "PAYMENT-REQUIRED": btoa(JSON.stringify(required)) } });

describe("payForDetail after the paid request is sent", () => {
  const kp = Keypair.random();
  const key = burnerKey(kp.secret());
  const url = "/api/check/detail?asset_code=USTRY&issuer=" + PAY_TO;

  it("is unknown when the paid request throws, with exactly two requests and no retry", async () => {
    const f = vi.fn().mockImplementationOnce(async () => unpaid()).mockImplementationOnce(async () => { throw new Error("network"); });
    const out = await payForDetail({ url, key, balanceBase: 100n, fetchFn: f as never });
    expect(out).toEqual({ kind: "unknown", tx: null });
    expect(f).toHaveBeenCalledTimes(2);
    // Nothing happens later on its own.
    await new Promise((r) => setTimeout(r, 20));
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("is unknown (not paid) when the paid request answers without a settlement", async () => {
    const f = vi.fn().mockImplementationOnce(async () => unpaid()).mockImplementationOnce(async () => new Response("{}", { status: 500 }));
    expect(await payForDetail({ url, key, balanceBase: 100n, fetchFn: f as never })).toEqual({ kind: "unknown", tx: null });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("puts the secret key in no URL and no header of either request, and sends the signature only on the second", async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const f = vi.fn(async (u: string, init?: RequestInit) => {
      seen.push({ url: String(u), headers: { ...((init?.headers as Record<string, string>) ?? {}) } });
      if (seen.length === 1) return unpaid();
      throw new Error("network");
    });
    await payForDetail({ url, key, balanceBase: 100n, fetchFn: f as never });
    expect(seen).toHaveLength(2);
    for (const r of seen) {
      expect(r.url).not.toContain(kp.secret());
      expect(JSON.stringify(r.headers)).not.toContain(kp.secret());
    }
    expect(Object.keys(seen[0].headers)).toHaveLength(0);
    expect(Object.keys(seen[1].headers).join(",")).toMatch(/PAYMENT-SIGNATURE/i);
  });
});
