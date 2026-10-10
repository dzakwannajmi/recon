import { Keypair } from "@stellar/stellar-sdk";
import { FacilitatorTimeoutError } from "@x402/core/server";
import { decodePaymentRequiredHeader, decodePaymentResponseHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import type { PaymentRequired } from "@x402/core/types";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import type { LoadedStatus } from "../factsheet/load";
import { ERROR_MESSAGES } from "./copy";
import { handleDetail, handleSummary, newDetailState, type DetailDeps, type SummaryDeps } from "./handlers";
import { MAX_TIMEOUT_SECONDS, USDC_TESTNET_SAC } from "./payment-config";
import { PAYWALL_HTML, createPaidHandler, createSeenSet, type LogLine } from "./paywall";
import { createRateLimiter } from "./rate-limit";
import { FAKE_PAYER, FAKE_TX_HASH, PAY_TO, SENTINEL_AMOUNT, entryFor, fakeFacilitator, fakeReader, paymentHeader, realAsset, realData } from "./testkit";

const NOW = new Date("2026-10-10T12:00:00.000Z");
const gbenji = realAsset("gBENJI");
const KEY = gbenji.asset.sac_contract_id as string;
const DETAIL = `http://localhost/api/check/detail?asset_code=gBENJI&issuer=${gbenji.asset.issuer}`;
const SUMMARY = `http://localhost/api/check?asset_code=gBENJI&issuer=${gbenji.asset.issuer}`;
const ENV = { X402_ENABLED: "true", X402_PAY_TO: PAY_TO, X402_TESTNET_AMOUNT: SENTINEL_AMOUNT };

const get = (url: string, headers: Record<string, string> = {}) => new NextRequest(url, { headers });
const limiter = (globalPerMin = 1000) => createRateLimiter({ perIpPerMin: 1000, globalPerMin, trustProxy: false });

function setup(over: { env?: Record<string, string | undefined>; data?: DetailDeps["data"]; limiter?: DetailDeps["limiter"] } = {}) {
  const facilitator = fakeFacilitator();
  const logs: LogLine[] = [];
  const seen = createSeenSet();
  const reader = fakeReader({ [KEY]: entryFor(gbenji.loaded, gbenji.asset) });
  const read = reader.readEntries.bind(reader);
  reader.readEntries = async (keys) => {
    facilitator.calls.order.push("handler");
    return read(keys);
  };
  const deps: DetailDeps = {
    env: { ...ENV, ...over.env },
    data: over.data ?? realData(),
    limiter: over.limiter ?? limiter(),
    buildPaid: (config, handler) => createPaidHandler({ config, facilitator, handler, seen, log: (l) => void logs.push(l) }),
    readerFactory: () => reader,
    log: (l) => void logs.push(l),
    now: () => NOW,
    state: newDetailState(),
    onchainCache: new Map(),
  };
  return { deps, facilitator, logs, reader, call: (req: NextRequest) => handleDetail(req, deps) };
}

const required = (res: Response): PaymentRequired => decodePaymentRequiredHeader(res.headers.get("payment-required") as string);
const paidRequest = (header: string) => get(DETAIL, { "payment-signature": header });

async function unpaidThenHeader(s: ReturnType<typeof setup>) {
  const first = await s.call(get(DETAIL));
  return { first, header: paymentHeader(required(first)) };
}

describe("free summary route", () => {
  const summaryDeps = (over: Partial<SummaryDeps> = {}): SummaryDeps => ({ env: {}, data: realData(), limiter: limiter(), ...over });

  it("S1: 200 with the summary, a cache header, no amount", async () => {
    const res = await handleSummary(get(SUMMARY), summaryDeps({ env: ENV }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=300, s-maxage=3600");
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const text = await res.text();
    const body = JSON.parse(text);
    expect(body).toMatchObject({ schema: "check-summary/1", status: "WARNING", paid_detail: { available: true } });
    expect(body.raised_flags[0].statement).toBe(gbenji.asset.raised[0].statement);
    expect(text).not.toContain(SENTINEL_AMOUNT);
    expect(text).not.toContain(PAY_TO);
  });

  it("reports the paid detail as unavailable when the configuration is off, still 200", async () => {
    const res = await handleSummary(get(SUMMARY), summaryDeps());
    expect((await res.json()).paid_detail.available).toBe(false);
  });

  it("answers errors with a fixed code and sentence: 400, 404, 409", async () => {
    const bad = await handleSummary(get("http://localhost/api/check?asset_code=a-b"), summaryDeps());
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "invalid_request", message: ERROR_MESSAGES.invalid_request });
    const extra = await handleSummary(get("http://localhost/api/check?asset_code=gBENJI&x=1"), summaryDeps());
    expect(extra.status).toBe(400);
    const lower = await handleSummary(get("http://localhost/api/check?asset_code=gbenji"), summaryDeps());
    expect(lower.status).toBe(404);
    expect(await lower.json()).toMatchObject({ error: "not_tracked", reason: "unknown_code", did_you_mean: ["gBENJI"] });
    const stable = await handleSummary(get("http://localhost/api/check?asset_code=USDC"), summaryDeps());
    expect(await stable.json()).toMatchObject({ error: "not_tracked", reason: "stablecoin_out_of_scope", scope: expect.stringContaining("out of scope") });
    const other = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 9)).publicKey();
    const wrong = await handleSummary(get(`http://localhost/api/check?asset_code=gBENJI&issuer=${other}`), summaryDeps());
    expect(await wrong.json()).toMatchObject({ error: "not_tracked", reason: "issuer_not_pinned", tracked_issuers: [{ issuer: gbenji.asset.issuer, official_domain: "franklintempleton.com" }] });
    for (const r of [bad, extra, lower]) expect(r.headers.get("cache-control")).toBe("no-store");
  });

  it("S2: an asset with status null gives 200 with the note", async () => {
    const data = realData();
    const loaded = data.status();
    const assets = loaded.status.assets.map((a) => (a.asset === gbenji.asset.asset ? { ...a, status: null, status_code: null, checked_at: null } : a));
    const withNull: LoadedStatus = { file: loaded.file, status: { ...loaded.status, assets } };
    const res = await handleSummary(get(SUMMARY), summaryDeps({ data: { ...data, status: () => withNull } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: null, feed: null, note: expect.stringContaining("No chain check is stored") });
  });

  it("S3: the third call over a global limit of 2 is 429 with Retry-After", async () => {
    const deps = summaryDeps({ limiter: limiter(2) });
    expect((await handleSummary(get(SUMMARY), deps)).status).toBe(200);
    expect((await handleSummary(get(SUMMARY), deps)).status).toBe(200);
    const third = await handleSummary(get(SUMMARY), deps);
    expect(third.status).toBe(429);
    expect(third.headers.get("retry-after")).toBe("60");
    expect(await third.json()).toMatchObject({ error: "rate_limited" });
  });

  it("answers 500 internal_error when the data cannot be loaded", async () => {
    const res = await handleSummary(get(SUMMARY), summaryDeps({ data: { ...realData(), universe: () => { throw new Error("The asset universe is empty or missing"); } } }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal_error", message: ERROR_MESSAGES.internal_error });
  });
});

describe("paid detail route: configuration and errors before any payment", () => {
  it("C: a disabled or misconfigured route answers 503, calls no facilitator, and logs only the reason once", async () => {
    const secret = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7)).secret();
    for (const [env, reason] of [
      [{ X402_ENABLED: undefined }, "disabled"],
      [{ PRICING_ENABLED: "true" }, "pricing_enabled_not_supported"],
      [{ X402_NETWORK: "stellar:pubnet" }, "network_not_testnet"],
      [{ X402_PAY_TO: secret }, "pay_to_is_secret"],
      [{ X402_TESTNET_AMOUNT: "0" }, "amount_invalid"],
      [{ X402_FACILITATOR_URL: "http://x402.org/facilitator" }, "facilitator_url_invalid"],
      [{ X402_FACILITATOR_URL: "https://evil.example/f" }, "facilitator_host_not_allowed"],
    ] as const) {
      const s = setup({ env });
      const res = await s.call(get(DETAIL));
      expect(res.status, reason).toBe(503);
      expect(await res.json()).toEqual({ error: "paid_detail_unavailable", message: ERROR_MESSAGES.paid_detail_unavailable });
      await s.call(get(DETAIL));
      expect(s.facilitator.calls).toMatchObject({ getSupported: 0, verify: 0, settle: 0 });
      expect(s.logs).toHaveLength(1);
      expect(s.logs[0]).toMatchObject({ event: "x402_unavailable", reason });
      const logged = JSON.stringify(s.logs);
      expect(logged).not.toContain(secret);
      expect(logged).not.toContain(SENTINEL_AMOUNT);
      expect(logged).not.toContain(PAY_TO);
    }
  });

  it("P13: an unknown asset is 404 and never 402; the facilitator is untouched", async () => {
    const s = setup();
    const res = await s.call(get("http://localhost/api/check/detail?asset_code=NOPE"));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "not_tracked", reason: "unknown_code" });
    expect(s.facilitator.calls.getSupported).toBe(0);
    const bad = await s.call(get("http://localhost/api/check/detail?asset_code=gBENJI&extra=1"));
    expect(bad.status).toBe(400);
  });

  it("409 not_published for an asset with status null, and 409 ambiguous for two issuers (never 402)", async () => {
    const data = realData();
    const loaded = data.status();
    const dup = { ...loaded.status.assets[0], issuer: Keypair.fromRawEd25519Seed(Buffer.alloc(32, 4)).publicKey() };
    const assets = [
      ...loaded.status.assets.map((a) => (a.asset === gbenji.asset.asset ? { ...a, status: null, status_code: null } : a)),
      dup,
    ];
    const tweaked: LoadedStatus = { file: loaded.file, status: { ...loaded.status, assets } };
    const s = setup({ data: { ...data, status: () => tweaked } });
    const unpublished = await s.call(get(DETAIL));
    expect(unpublished.status).toBe(409);
    expect(await unpublished.json()).toMatchObject({ error: "not_published" });
    const ambiguous = await s.call(get(`http://localhost/api/check/detail?asset_code=${dup.asset_code}`));
    expect(ambiguous.status).toBe(409);
    expect(await ambiguous.json()).toMatchObject({ error: "ambiguous_asset", issuers: expect.any(Array) });
    expect(s.facilitator.calls.getSupported).toBe(0);
  });

  it("P11: a payment header over 16 KB is 400 before any facilitator call", async () => {
    const s = setup();
    const res = await s.call(paidRequest("A".repeat(16_385)));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_request");
    const legacy = await s.call(get(DETAIL, { "x-payment": "A".repeat(16_385) }));
    expect(legacy.status).toBe(400);
    expect(s.facilitator.calls).toMatchObject({ getSupported: 0, verify: 0, settle: 0 });
  });

  it("P12: the paid route rate limit answers 429 before any facilitator call, even with a payment header", async () => {
    const s = setup({ limiter: limiter(1) });
    const first = await s.call(get(DETAIL));
    expect(first.status).toBe(402);
    const verifyBefore = s.facilitator.calls.verify;
    const second = await s.call(paidRequest(paymentHeader(required(first))));
    expect(second.status).toBe(429);
    expect(second.headers.get("retry-after")).toBe("60");
    expect(s.facilitator.calls.verify).toBe(verifyBefore);
    expect(s.facilitator.calls.settle).toBe(0);
  });
});

describe("paid detail route: the x402 flow", () => {
  it("P1: no payment header gives 402 with the requirements in the header and no amount in the body", async () => {
    const s = setup();
    const res = await s.call(get(DETAIL));
    expect(res.status).toBe(402);
    const text = await res.text();
    expect(text).not.toContain(SENTINEL_AMOUNT);
    expect(text).not.toContain(PAY_TO);
    expect(JSON.parse(text)).toMatchObject({ error: "payment_required", protocol: "x402", network: "stellar:testnet", free_summary: `/api/check?asset_code=gBENJI&issuer=${gbenji.asset.issuer}` });
    expect(res.headers.get("cache-control")).toBe("no-store");
    const req = required(res);
    expect(req.x402Version).toBe(2);
    expect(req.accepts).toHaveLength(1);
    expect(req.accepts[0]).toMatchObject({ scheme: "exact", network: "stellar:testnet", asset: USDC_TESTNET_SAC, payTo: PAY_TO, amount: SENTINEL_AMOUNT, maxTimeoutSeconds: MAX_TIMEOUT_SECONDS });
    expect(req.accepts[0].extra).not.toHaveProperty("paymentFlow");
    expect(s.reader.calls).toHaveLength(0);
    expect(s.facilitator.calls).toMatchObject({ verify: 0, settle: 0 });
  });

  it("P2: a browser gets the static page with no amount", async () => {
    const s = setup();
    const res = await s.call(get(DETAIL, { accept: "text/html,application/xhtml+xml", "user-agent": "Mozilla/5.0 (X11; Linux x86_64)" }));
    expect(res.status).toBe(402);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toBe(PAYWALL_HTML);
    expect(html).not.toContain(SENTINEL_AMOUNT);
    expect(html).not.toContain(PAY_TO);
  });

  it("P3: a valid payment gives 200 with the detail and PAYMENT-RESPONSE; the order is verify, handler, settle", async () => {
    const s = setup();
    const { header } = await unpaidThenHeader(s);
    const res = await s.call(paidRequest(header));
    expect(res.status).toBe(200);
    const settle = decodePaymentResponseHeader(res.headers.get("payment-response") as string);
    expect(settle).toMatchObject({ success: true, transaction: FAKE_TX_HASH, network: "stellar:testnet", payer: FAKE_PAYER });
    const body = await res.json();
    expect(body).toMatchObject({ schema: "check-detail/1", status: { value: "WARNING" }, feed: { onchain: { read: "ok", matches: true } } });
    expect(body.flags).toHaveLength(9);
    expect(s.facilitator.calls.order).toEqual(["verify", "handler", "settle"]);
    expect(s.facilitator.calls.getSupported).toBe(1);
    expect(res.headers.get("cache-control")).toContain("private");
    expect(s.logs.find((l) => l.event === "x402_settled")).toMatchObject({ asset: gbenji.asset.asset, payer: FAKE_PAYER, tx: FAKE_TX_HASH });
    const logged = JSON.stringify(s.logs);
    expect(logged).not.toContain(SENTINEL_AMOUNT);
    expect(logged).not.toContain(header);
  });

  it("P4: an invalid payment gives 402 with the reason and no content; settle is not called", async () => {
    const s = setup();
    s.facilitator.verifyImpl = async () => ({ isValid: false, invalidReason: "invalid_exact_stellar_payload_wrong_amount" });
    const { header } = await unpaidThenHeader(s);
    const res = await s.call(paidRequest(header));
    expect(res.status).toBe(402);
    expect(required(res).error).toBe("invalid_exact_stellar_payload_wrong_amount");
    expect(await res.text()).not.toContain("check-detail");
    expect(s.facilitator.calls.settle).toBe(0);
    expect(s.reader.calls).toHaveLength(0);
  });

  it("P5: the same payment header again is refused as already used, without a facilitator call", async () => {
    const s = setup();
    const { header } = await unpaidThenHeader(s);
    expect((await s.call(paidRequest(header))).status).toBe(200);
    const verifyCalls = s.facilitator.calls.verify;
    const again = await s.call(paidRequest(header));
    expect(again.status).toBe(402);
    expect(required(again).error).toBe("payment_already_used");
    expect(s.facilitator.calls.verify).toBe(verifyCalls);
    expect(await again.text()).not.toContain("check-detail");
  });

  it("P6: settle with success false gives 402 settlement_failed and no detail; the payment is not marked as used", async () => {
    const s = setup();
    s.facilitator.settleImpl = async () => ({ success: false, errorReason: "settle_exact_stellar_transaction_failed", transaction: "", network: "stellar:testnet" });
    const { header } = await unpaidThenHeader(s);
    const res = await s.call(paidRequest(header));
    expect(res.status).toBe(402);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: "settlement_failed", message: ERROR_MESSAGES.settlement_failed, reason: "settle_exact_stellar_transaction_failed", transaction: null });
    expect(text).not.toContain("check-detail");
    expect(text).not.toContain(SENTINEL_AMOUNT);
    expect(s.logs.find((l) => l.event === "x402_settle_failed")).toMatchObject({ reason: "settle_exact_stellar_transaction_failed" });
    // A payment that did not settle is not remembered as used: the facilitator is asked again.
    await s.call(paidRequest(header));
    expect(s.facilitator.calls.verify).toBe(2);
  });

  it("P6c: two concurrent requests with the same payment: only one settles, the other gets 402 and no content", async () => {
    const s = setup();
    let settles = 0;
    s.facilitator.settleImpl = async () =>
      ++settles === 1
        ? { success: true, transaction: FAKE_TX_HASH, network: "stellar:testnet", payer: FAKE_PAYER }
        : { success: false, errorReason: "settle_exact_stellar_nonce_used", transaction: "", network: "stellar:testnet" };
    const { header } = await unpaidThenHeader(s);
    const [a, b] = await Promise.all([s.call(paidRequest(header)), s.call(paidRequest(header))]);
    expect([a.status, b.status].sort()).toEqual([200, 402]);
    const loser = a.status === 402 ? a : b;
    expect(await loser.text()).not.toContain("check-detail");
  });

  it("P6b: a settle that throws a plain error is also 402 settlement_failed with a sanitized reason", async () => {
    const s = setup();
    s.facilitator.settleImpl = async () => {
      throw new Error("fetch failed: connection reset while paying 4242");
    };
    const { header } = await unpaidThenHeader(s);
    const res = await s.call(paidRequest(header));
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body).toMatchObject({ error: "settlement_failed", reason: "unspecified", transaction: null });
    expect(JSON.stringify(s.logs)).not.toContain(SENTINEL_AMOUNT);
  });

  it("P7: a settle timeout gives 502, no detail, and a x402_settle_unknown log line", async () => {
    const s = setup();
    s.facilitator.settleImpl = async () => {
      throw new FacilitatorTimeoutError("settle", 80_000);
    };
    const { header } = await unpaidThenHeader(s);
    const res = await s.call(paidRequest(header));
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain("check-detail");
    const line = s.logs.find((l) => l.event === "x402_settle_unknown");
    expect(line).toMatchObject({ asset: gbenji.asset.asset, reason: "timeout" });
    expect(String(line?.payload)).toMatch(/^[0-9a-f]{16}$/);
  });

  it("P8: when the facilitator cannot be reached for /supported the answer is 5xx with no 402 and no content, and the next request retries", async () => {
    const s = setup();
    s.facilitator.getSupportedImpl = async () => {
      throw new Error("down");
    };
    const res = await s.call(get(DETAIL));
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(res.headers.get("payment-required")).toBeNull();
    expect(await res.text()).not.toContain("check-detail");
    s.facilitator.getSupportedImpl = fakeFacilitator().getSupportedImpl;
    const retry = await s.call(get(DETAIL));
    expect(retry.status).toBe(402);
    expect(s.facilitator.calls.getSupported).toBe(2);
  });

  it("P9: a handler integrity error (tampered evidence_hash) gives 500 and settle is never called", async () => {
    const data = realData();
    const loaded = data.status();
    const assets = loaded.status.assets.map((a) => (a.asset === gbenji.asset.asset ? { ...a, evidence_hash: "0".repeat(64) } : a));
    const tampered: LoadedStatus = { file: loaded.file, status: { ...loaded.status, assets } };
    const s = setup({ data: { ...data, status: () => tampered } });
    const { header } = await unpaidThenHeader(s);
    const res = await s.call(paidRequest(header));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("check-detail");
    expect(s.facilitator.calls.verify).toBe(1);
    expect(s.facilitator.calls.settle).toBe(0);
  });

  it("P10: a payload that claims the pubnet is 402 without a verify call", async () => {
    const s = setup();
    const first = await s.call(get(DETAIL));
    const req = required(first);
    const header = encodePaymentSignatureHeader({ x402Version: 2, accepted: { ...req.accepts[0], network: "stellar:pubnet" }, payload: { transaction: "AAAAfake-pubnet" } });
    const res = await s.call(paidRequest(header));
    expect(res.status).toBe(402);
    expect(required(res).error).toBe("No matching payment requirements");
    expect(s.facilitator.calls.verify).toBe(0);
    expect(s.facilitator.calls.settle).toBe(0);
  });

  it("a payload with a lower amount or another payee is not matched either", async () => {
    const s = setup();
    const req = required(await s.call(get(DETAIL)));
    for (const accepted of [{ ...req.accepts[0], amount: "1" }, { ...req.accepts[0], payTo: FAKE_PAYER }, { ...req.accepts[0], asset: PAY_TO }]) {
      const res = await s.call(paidRequest(encodePaymentSignatureHeader({ x402Version: 2, accepted, payload: { transaction: "AAAAfake-x" } })));
      expect(res.status).toBe(402);
    }
    expect(s.facilitator.calls.verify).toBe(0);
  });

  it("a payload without a transaction string is refused as malformed", async () => {
    const s = setup();
    const req = required(await s.call(get(DETAIL)));
    const res = await s.call(paidRequest(encodePaymentSignatureHeader({ x402Version: 2, accepted: req.accepts[0], payload: { transaction: 5 } as never })));
    expect(res.status).toBe(402);
    expect(required(res).error).toBe("payment_malformed");
    expect(s.facilitator.calls.verify).toBe(0);
  });

  it("no body of any response in the flow holds the amount", async () => {
    const s = setup();
    const { first, header } = await unpaidThenHeader(s);
    const responses = [first, await s.call(paidRequest(header)), await s.call(paidRequest(header)), await s.call(get(DETAIL))];
    for (const r of responses) expect(await r.text()).not.toContain(SENTINEL_AMOUNT);
  });
});
