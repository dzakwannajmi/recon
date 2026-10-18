import { describe, expect, it } from "vitest";
import { FetchError } from "../chain/http";
import { BudgetExhausted, createHorizonClient } from "./horizon";
import { ETHERFUSE, HOLDER, payment, token } from "./testkit";
import type { HorizonOp } from "./types";

const H = "https://horizon.stellar.org";
const OPS_URL = `${H}/accounts/${ETHERFUSE}/operations?include_failed=false&limit=200`;

type Reply = unknown | Error;
/** A fetch stand-in that answers by URL prefix from a queue and records every URL. */
function scripted(routes: Record<string, Reply[]>) {
  const urls: string[] = [];
  const fetchJson = async (url: string) => {
    urls.push(url);
    const key = Object.keys(routes).sort((a, b) => b.length - a.length).find((k) => url.startsWith(k));
    if (!key || routes[key].length === 0) throw new Error(`unexpected request ${url}`);
    const r = routes[key].length > 1 ? routes[key].shift() : routes[key][0];
    if (r instanceof Error) throw r;
    return r;
  };
  return { fetchJson, urls };
}
const sleeps: number[] = [];
const sleep = async (ms: number) => { sleeps.push(ms); };
const root = (ledger: number, at = "2026-10-17T10:00:00Z") => ({ history_latest_ledger: ledger, history_latest_ledger_closed_at: at });
const page = (records: HorizonOp[], next?: string) => ({ _embedded: { records }, _links: next ? { next: { href: next } } : {} });
const ops = (n: number, firstLedger = 100): HorizonOp[] =>
  Array.from({ length: n }, (_, i) => ({ ...payment(firstLedger + i, "2026-10-17T09:00:00Z", "USTRY", ETHERFUSE, ETHERFUSE, HOLDER, "1.0000000"), paging_token: token(firstLedger + i, 1), id: token(firstLedger + i, 1) }));
const client = (routes: Record<string, Reply[]>, maxRequests = 300) => {
  const s = scripted(routes);
  return { ...s, c: createHorizonClient({ maxRequests, fetchJson: s.fetchJson, sleep, paceMs: 250, retryMs: 2000 }) };
};

describe("H1: paging", () => {
  it("reads forward with limit=200, include_failed=false, an ascending cursor; a short page means caught up", async () => {
    const { c, urls } = client({ [`${H}/`]: [root(5000)], [OPS_URL]: [page(ops(3))] });
    const r = await c.readIssuerOps(ETHERFUSE, { mode: "forward", cursor: token(90), maxPages: 60 });
    expect(urls[0]).toBe(`${H}/`);
    expect(urls[1]).toBe(`${OPS_URL}&order=asc&cursor=${token(90)}`);
    expect(r).toMatchObject({ caughtUp: true, partial: false, error: null, pages: 1, coveredThroughLedger: 5000, coveredThroughAt: "2026-10-17T10:00:00Z" });
    expect(r.ops).toHaveLength(3);
    // continue after the last operation of the root ledger, so nothing is read twice
    expect(r.newestCursor).toBe(((5001n << 32n) - 1n).toString());
    expect(c.requests).toBe(2);
  });

  it("follows a next link on the Horizon origin, and counts every request", async () => {
    const next = `${OPS_URL}&order=asc&cursor=${token(299)}`;
    const { c, urls } = client({ [`${H}/`]: [root(5000)], [`${OPS_URL}&order=asc&cursor=${token(90)}`]: [page(ops(200), next)], [next]: [page(ops(5, 300))] });
    const r = await c.readIssuerOps(ETHERFUSE, { mode: "forward", cursor: token(90), maxPages: 60 });
    expect(r.ops).toHaveLength(205);
    expect(urls).toHaveLength(3);
    expect(r.pages).toBe(2);
    expect(c.requests).toBe(3);
  });

  it("stops the issuer when a next link points at another origin, keeping the ops read", async () => {
    const evil = `https://evil.example/accounts/${ETHERFUSE}/operations?cursor=1`;
    const { c, urls } = client({ [`${H}/`]: [root(5000)], [OPS_URL]: [page(ops(200), evil)] });
    const r = await c.readIssuerOps(ETHERFUSE, { mode: "forward", cursor: token(90), maxPages: 60 });
    expect(r).toMatchObject({ partial: true, caughtUp: false, error: "paging link points outside Horizon" });
    expect(r.ops).toHaveLength(200);
    expect(urls.some((u) => u.startsWith("https://evil.example"))).toBe(false);
    // coverage stops before the last op's ledger
    expect(r.coveredThroughLedger).toBe(299 - 1);
    expect(r.newestCursor).toBe(token(299, 1));
  });

  it("ends paging at the request budget as partial, without an error", async () => {
    const next = `${OPS_URL}&order=asc&cursor=x`;
    const { c } = client({ [`${H}/`]: [root(5000)], [OPS_URL]: [page(ops(200), next)], [next]: [page(ops(200, 400), next)] }, 3);
    const r = await c.readIssuerOps(ETHERFUSE, { mode: "forward", cursor: token(90), maxPages: 60 });
    expect(r).toMatchObject({ partial: true, error: null, pages: 2, caughtUp: false });
    expect(c.requests).toBe(3);
    await expect(createHorizonClient({ maxRequests: 0, fetchJson: async () => root(1), sleep }).readIssuerOps(ETHERFUSE, { mode: "forward", cursor: "1", maxPages: 1 })).resolves.toMatchObject({ partial: true, ops: [] });
  });

  it("ends at the per-issuer page cap as partial", async () => {
    const next = `${OPS_URL}&order=asc&cursor=x`;
    const { c } = client({ [`${H}/`]: [root(5000)], [OPS_URL]: [page(ops(200), next)], [next]: [page(ops(200, 400), next)] });
    const r = await c.readIssuerOps(ETHERFUSE, { mode: "forward", cursor: token(90), maxPages: 2 });
    expect(r).toMatchObject({ partial: true, pages: 2, caughtUp: false });
    expect(r.ops).toHaveLength(400);
  });

  it("retries a 429 once after 2 s and counts both requests; a second failure stops the issuer", async () => {
    sleeps.length = 0;
    const { c } = client({ [`${H}/`]: [root(5000)], [OPS_URL]: [new FetchError("HTTP 429 from https://horizon.stellar.org."), page(ops(2))] });
    const r = await c.readIssuerOps(ETHERFUSE, { mode: "forward", cursor: token(90), maxPages: 60 });
    expect(r.ops).toHaveLength(2);
    expect(sleeps).toContain(2000);
    expect(c.requests).toBe(3);

    const bad = client({ [`${H}/`]: [root(5000)], [OPS_URL]: [new FetchError("HTTP 503 from https://horizon.stellar.org.")] });
    const r2 = await bad.c.readIssuerOps(ETHERFUSE, { mode: "forward", cursor: token(90), maxPages: 60 });
    expect(r2).toMatchObject({ partial: true, caughtUp: false, ops: [] });
    expect(r2.error).toMatch(/HTTP 503/);
    expect(bad.c.requests).toBe(3); // root, the page, one retry
  });

  it("does not retry other errors, and refuses a malformed record", async () => {
    const notFound = client({ [`${H}/`]: [root(5000)], [OPS_URL]: [new FetchError("Not found.")] });
    const r = await notFound.c.readIssuerOps(ETHERFUSE, { mode: "forward", cursor: token(90), maxPages: 60 });
    expect(r).toMatchObject({ partial: true, error: "Not found." });
    expect(notFound.c.requests).toBe(2);
    const bad = client({ [`${H}/`]: [root(5000)], [OPS_URL]: [{ _embedded: { records: [{ id: "x" }] } }] });
    expect((await bad.c.readIssuerOps(ETHERFUSE, { mode: "forward", cursor: token(90), maxPages: 60 })).partial).toBe(true);
    expect((await client({}).c.readIssuerOps("not-an-account", { mode: "forward", cursor: "1", maxPages: 1 })).error).toBe("invalid issuer account");
  });

  it("backfills newest first down to the cutoff, returns the ops oldest first, and covers from the cutoff", async () => {
    const recent = ops(3, 300).map((o, i) => ({ ...o, created_at: `2026-10-16T0${i}:00:00Z` }));
    const old = { ...ops(1, 100)[0], created_at: "2026-10-01T00:00:00Z" };
    const desc = [...recent].reverse().concat(old);
    const { c, urls } = client({ [`${H}/`]: [root(5000)], [OPS_URL]: [page(desc)] });
    const r = await c.readIssuerOps(ETHERFUSE, { mode: "backfill", since: "2026-10-08T00:00:00Z", maxPages: 60 });
    expect(urls[1]).toBe(`${OPS_URL}&order=desc`);
    expect(r.ops.map((o) => o.paging_token)).toEqual(recent.map((o) => o.paging_token));
    expect(r).toMatchObject({ coveredFrom: "2026-10-08T00:00:00Z", caughtUp: true, partial: false, coveredThroughLedger: 5000 });
  });

  it("a backfill cut short by the page cap covers only from its oldest op", async () => {
    const full = ops(200, 300).map((o, i) => ({ ...o, created_at: new Date(Date.parse("2026-10-16T00:00:00Z") + (200 - i) * 1000).toISOString().replace(".000", "") }));
    const next = `${OPS_URL}&order=desc&cursor=y`;
    const { c } = client({ [`${H}/`]: [root(5000)], [OPS_URL]: [page([...full].reverse(), next)] });
    const r = await c.readIssuerOps(ETHERFUSE, { mode: "backfill", since: "2026-10-08T00:00:00Z", maxPages: 1 });
    expect(r.partial).toBe(true);
    expect(r.coveredFrom).toBe(r.ops[0].created_at);
    expect(r.caughtUp).toBe(true); // the head page was read
  });

  it("reads the effects of an op, and gives null for a bad id or an error", async () => {
    const { c, urls } = client({ [`${H}/operations/`]: [{ _embedded: { records: [{ type: "account_credited", account: ETHERFUSE, amount: "5.0000000" }] } }] });
    expect(await c.readOpEffects("278955591845011457")).toEqual([{ type: "account_credited", account: ETHERFUSE, amount: "5.0000000" }]);
    expect(urls[0]).toBe(`${H}/operations/278955591845011457/effects?limit=200`);
    expect(await c.readOpEffects("../x")).toBeNull();
    expect(await client({ [`${H}/operations/`]: [new FetchError("Not found.")] }).c.readOpEffects("1")).toBeNull();
  });

  it("a budget error is its own class", () => {
    expect(new BudgetExhausted()).toBeInstanceOf(Error);
  });
});

describe("H2: supply points are precise only when the ledger did not move", () => {
  const A = { code: "USTRY", issuer: ETHERFUSE };
  const record = (supply: string) => ({ _embedded: { records: [{ asset_code: "USTRY", asset_issuer: ETHERFUSE, balances: { authorized: supply, authorized_to_maintain_liabilities: "0.0000000", unauthorized: "0.0000000" }, claimable_balances_amount: "1.0000000", liquidity_pools_amount: "0.0000000", contracts_amount: "0.0000000" }] } });
  const ASSETS = `${H}/assets?asset_code=USTRY&asset_issuer=${ETHERFUSE}`;

  it("same ledger before and after gives a point with the root's ledger and close time, summing every place the asset is held", async () => {
    const { c } = client({ [`${H}/`]: [root(7000, "2026-10-17T10:00:05Z")], [ASSETS]: [record("10.0000000")] });
    const r = await c.readSupplyPoints([A]);
    expect(r.points.get(`USTRY:${ETHERFUSE}`)).toEqual({ ledger: 7000, at: "2026-10-17T10:00:05Z", supply: "11.0000000", source: "monitor" });
    expect(c.requests).toBe(3);
  });

  it("neighbouring assets share the root read between them (n assets cost 2n+1 requests)", async () => {
    const eurob = record("5.0000000");
    eurob._embedded.records[0].asset_code = "EUROB";
    const { c } = client({ [`${H}/`]: [root(7000)], [ASSETS]: [record("10.0000000")], [`${H}/assets?asset_code=EUROB`]: [eurob] });
    const r = await c.readSupplyPoints([A, { code: "EUROB", issuer: ETHERFUSE }]);
    expect(r.points.size).toBe(2);
    expect(c.requests).toBe(5);
  });

  it("retries when the ledger moved, then succeeds; after three tries there is no point", async () => {
    const moved = client({ [`${H}/`]: [root(7000), root(7001), root(7001)], [ASSETS]: [record("10.0000000")] });
    const r = await moved.c.readSupplyPoints([A]);
    expect(r.points.get(`USTRY:${ETHERFUSE}`)?.ledger).toBe(7001);
    expect(moved.c.requests).toBe(5); // root, asset, root(moved), asset, root

    const always = client({ [`${H}/`]: [root(1), root(2), root(3), root(4), root(5), root(6), root(7)], [ASSETS]: [record("10.0000000")] });
    const r2 = await always.c.readSupplyPoints([A]);
    expect(r2.points.size).toBe(0);
    expect(r2.failures.get(`USTRY:${ETHERFUSE}`)).toBe("ledger moved during the read three times");
    expect(always.c.requests).toBe(1 + 3 * 2);
  });

  it("an unknown asset has no point and is not retried; the budget ending is reported", async () => {
    const none = client({ [`${H}/`]: [root(7000)], [ASSETS]: [{ _embedded: { records: [] } }] });
    const r = await none.c.readSupplyPoints([A]);
    expect(r.failures.get(`USTRY:${ETHERFUSE}`)).toBe("asset not found");
    expect(none.c.requests).toBe(3);
    const cap = client({ [`${H}/`]: [root(7000)], [ASSETS]: [record("1.0000000")] }, 2);
    expect((await cap.c.readSupplyPoints([A])).budgetEnded).toBe(true);
  });
});
