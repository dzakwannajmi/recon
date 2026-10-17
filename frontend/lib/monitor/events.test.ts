import { describe, expect, it } from "vitest";
import { formatStroops } from "../chain/asset";
import { classifyOp } from "./classify";
import { describeEvent, intradayLarge, issuerChangeEvent, largeEventId, opEventId, unreconciledEventId, updateIntraday } from "./events";
import type { AssetOp } from "./reconcile";
import { ETHERFUSE, ETHERFUSE_CODES, SIGNER, op } from "./testkit";

const A = (n: number) => formatStroops(BigInt(Math.round(n * 10_000_000)));
const aop = (n: number, side: "mint" | "burn", at = "2026-10-17T05:00:00Z", ledger = 5): AssetOp => ({ ledger, at, tx: `t${ledger}`, side, amount: BigInt(n) * 10_000_000n });
const KEY = "X:G";

describe("K2: intraday large mint or burn", () => {
  const run = (minted: number, burned: number, base: number, seen: string[] = []) =>
    intradayLarge({
      asset: KEY, issuer: "G", today: "2026-10-17", intraday: { date: "2026-10-17", minted: A(minted), burned: A(burned) }, seen, base: BigInt(base) * 10_000_000n,
      latest: { mint: aop(minted, "mint"), burn: aop(burned, "burn", "2026-10-17T06:00:00Z", 6) }, seenAt: "2026-10-17T07:00:00Z",
    });

  it("exactly 20% is not large; just above is, per side", () => {
    expect(run(200, 0, 1000).events).toEqual([]);
    expect(run(0, 200, 1000).events).toEqual([]);
    const m = run(201, 0, 1000);
    expect(m.events).toHaveLength(1);
    expect(m.events[0]).toMatchObject({ type: "large_mint_burn", side: "mint", amount: A(201), base: A(1000), share: "20.1", assets: [KEY], ledger: 5, ledger_closed_at: "2026-10-17T05:00:00Z" });
    const both = run(300, 300, 1000);
    expect(both.events.map((e) => e.side)).toEqual(["mint", "burn"]);
  });

  it("raises once per (asset, day, side): a side already seen is skipped", () => {
    const first = run(300, 0, 1000);
    expect(first.seen).toEqual(["2026-10-17:mint"]);
    expect(run(400, 0, 1000, first.seen).events).toEqual([]);
    expect(run(400, 300, 1000, first.seen).events.map((e) => e.side)).toEqual(["burn"]);
  });

  it("has no event without a base", () => {
    expect(intradayLarge({ asset: KEY, issuer: "G", today: "2026-10-17", intraday: { date: "2026-10-17", minted: A(9), burned: A(0) }, seen: [], base: null, latest: { mint: null, burn: null }, seenAt: "t" }).events).toEqual([]);
    expect(run(1, 0, 0).events).toEqual([]);
  });

  it("event ids are deterministic across runs and differ by day and side", () => {
    expect(run(300, 0, 1000).events[0].id).toBe(run(300, 0, 1000).events[0].id);
    expect(largeEventId(KEY, "2026-10-17", "mint")).toBe(largeEventId(KEY, "2026-10-17", "mint"));
    expect(new Set([largeEventId(KEY, "2026-10-17", "mint"), largeEventId(KEY, "2026-10-17", "burn"), largeEventId(KEY, "2026-10-18", "mint")]).size).toBe(3);
    expect(largeEventId(KEY, "2026-10-17", "mint")).toMatch(/^[0-9a-f]{16}$/);
    expect(opEventId("issuer_options", "1")).not.toBe(opEventId("issuer_merged", "1"));
    expect(unreconciledEventId(KEY, 1, 2)).toBe(unreconciledEventId(KEY, 1, 2));
  });

  it("updateIntraday resets on a new day and counts only ops dated today", () => {
    const prev = { date: "2026-10-16", minted: A(50), burned: A(1) };
    const next = updateIntraday(prev, "2026-10-17", [aop(10, "mint"), aop(4, "burn"), aop(99, "mint", "2026-10-16T23:00:00Z")]);
    expect(next).toEqual({ date: "2026-10-17", minted: A(10), burned: A(4) });
    expect(updateIntraday(next, "2026-10-17", [aop(5, "mint")])).toEqual({ date: "2026-10-17", minted: A(15), burned: A(4) });
  });
});

describe("issuer change events", () => {
  it("makes the same event id when the same op is seen twice, with a neutral description", () => {
    const o = op("set_options", 64807581, "2026-10-06T21:54:47Z", { signer_key: SIGNER, signer_weight: 2 });
    const change = classifyOp(o, ETHERFUSE, ETHERFUSE_CODES).issuerChange!;
    const a = issuerChangeEvent(o, ETHERFUSE, ETHERFUSE_CODES.map((c) => `${c}:${ETHERFUSE}`), change, "t1");
    const b = issuerChangeEvent(o, ETHERFUSE, ETHERFUSE_CODES.map((c) => `${c}:${ETHERFUSE}`), change, "t2");
    expect(a.id).toBe(b.id);
    expect(a).toMatchObject({ type: "issuer_options", ledger: 64807581, ledger_closed_at: "2026-10-06T21:54:47Z", op_id: o.id });
    expect(describeEvent(a)).toBe("set_options by issuer GCRYUG…MYWC at ledger 64807581 (2026-10-06T21:54:47Z): signer GAQW5U…4UHG weight 2");
    expect(describeEvent(a)).not.toMatch(/unsafe|risky|fraud|scam|suspicious|rating|score|grade|price/i);
  });
});
