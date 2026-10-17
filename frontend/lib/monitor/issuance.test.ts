import { describe, expect, it } from "vitest";
import { formatStroops } from "../chain/asset";
import { buildIssuance, issuanceWindow, mintBurnInputFor, parseIssuance, stableJson } from "./issuance";
import { advance, emptyAssetState, type AssetOp } from "./reconcile";
import type { MonitorState, Point } from "./types";
import { flagLargeMintBurn } from "../flags/monitor";

const A = (n: number) => formatStroops(BigInt(Math.round(n * 10_000_000)));
const pt = (ledger: number, at: string, supply: number): Point => ({ ledger, at, supply: A(supply), source: "monitor" });
const aop = (ledger: number, at: string, side: "mint" | "burn", amount: number, tx: string): AssetOp => ({ ledger, at, tx, side, amount: BigInt(Math.round(amount * 10_000_000)) });

const KEY = "BB1:GD5J";
const OTHER = "ZZ:GBBB";
function state(): MonitorState {
  let s = advance(emptyAssetState("2026-10-17"), [pt(1, "2026-10-08T12:00:00Z", 1000)], [], []).state;
  s = advance(s, [pt(500, "2026-10-17T01:00:00Z", 1000 + 300 - 5)], [
    aop(10, "2026-10-12T10:00:00Z", "mint", 100, "tx-b"),
    aop(11, "2026-10-12T11:00:00Z", "mint", 200, "tx-a"),
    aop(12, "2026-10-13T11:00:00Z", "burn", 5, "tx-c"),
  ], []).state;
  return { version: 1, issuers: {}, assets: { [KEY]: s }, pending: [] };
}

describe("I1: issuance builder", () => {
  it("the window is D-8 to D-1", () => {
    expect(issuanceWindow("2026-10-17")).toEqual(["2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"]);
  });

  it("puts proven days in days and every other window day in missing, assets in the given order", () => {
    const f = buildIssuance("2026-10-17", "2026-10-17T02:00:00.000Z", state(), [OTHER, KEY]);
    expect(f.assets.map((a) => a.asset)).toEqual([OTHER, KEY]);
    expect(f.assets[0].days).toEqual([]);
    expect(f.assets[0].missing).toHaveLength(8);
    const a = f.assets[1];
    expect(a.days.map((d) => d.date)).toEqual(["2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"]);
    expect(a.missing).toEqual([]);
    expect(a.days.find((d) => d.date === "2026-10-12")).toEqual({
      date: "2026-10-12", minted: A(300), burned: A(0), supply_end: A(1300), ops: 2,
      top_tx: [{ tx: "tx-a", side: "mint", amount: A(200) }, { tx: "tx-b", side: "mint", amount: A(100) }],
    });
    expect(a.days.find((d) => d.date === "2026-10-13")).toMatchObject({ burned: A(5), supply_end: A(1295) });
    expect(a.days.find((d) => d.date === "2026-10-16")).toMatchObject({ minted: A(0), ops: 0, supply_end: A(1295) });
    expect(f).toMatchObject({ monitor_version: 1, day: "2026-10-17", window: { from: "2026-10-09", to: "2026-10-16" }, horizon: "https://horizon.stellar.org" });
  });

  it("a day before the first point is missing as not_covered", () => {
    const f = buildIssuance("2026-10-20", "2026-10-20T02:00:00.000Z", state(), [KEY]);
    const a = f.assets[0];
    expect(a.missing.map((m) => [m.date, m.reason])).toEqual([["2026-10-17", "not_covered"], ["2026-10-18", "not_covered"], ["2026-10-19", "not_covered"]]);
  });

  it("gives byte-identical output for the same input, whatever the key order", () => {
    const one = stableJson(buildIssuance("2026-10-17", "t", state(), [KEY]));
    const two = stableJson(JSON.parse(JSON.stringify(buildIssuance("2026-10-17", "t", state(), [KEY]))));
    expect(one).toBe(two);
    const shuffled = JSON.parse(one) as Record<string, unknown>;
    expect(stableJson(Object.fromEntries(Object.entries(shuffled).reverse()))).toBe(one);
    expect(parseIssuance(JSON.parse(one))).toEqual(JSON.parse(one));
  });

  it("parseIssuance refuses a malformed file", () => {
    expect(() => parseIssuance({ monitor_version: 2 })).toThrow(/issuance file is invalid/);
  });

  it("mintBurnInputFor maps one asset with missing dates and a reference, and null for an unknown asset", () => {
    const f = buildIssuance("2026-10-20", "t", state(), [KEY]);
    const input = mintBurnInputFor(f, KEY)!;
    expect(input.ref).toBe(`data/monitor/issuance/2026-10-20.json#${KEY}`);
    expect(input.missing).toEqual(["2026-10-17", "2026-10-18", "2026-10-19"]);
    expect(input.days).toHaveLength(5);
    expect(mintBurnInputFor(f, "NOPE:G")).toBeNull();
  });

  it("E3 (decider side): a large proven day raises LARGE_MINT_BURN through the decider", () => {
    // 300 minted on 10-12 against a base of 1300: 23% -> large
    const f = buildIssuance("2026-10-17", "t", state(), [KEY]);
    const e = flagLargeMintBurn(mintBurnInputFor(f, KEY), "2026-10-17");
    expect(e).toMatchObject({ outcome: "raised", severity: "WARNING", as_of: "2026-10-17" });
    expect(e.outcome === "raised" && e.statement).toContain("Single-day mint of 300 on 2026-10-12 is 23.07% of supply (1300)");
  });
});
