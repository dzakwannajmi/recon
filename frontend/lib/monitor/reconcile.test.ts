import { describe, expect, it } from "vitest";
import { formatStroops } from "../chain/asset";
import { advance, anchoredPoints, completeDays, emptyAssetState, mergeTop, usablePoints, type AssetOp } from "./reconcile";
import type { Point } from "./types";

const A = (n: number | string) => formatStroops(BigInt(Math.round(Number(n) * 10_000_000)));
const pt = (ledger: number | null, at: string, supply: number, source: Point["source"] = "monitor"): Point => ({ ledger, at, supply: A(supply), source });
const aop = (ledger: number, at: string, side: "mint" | "burn", amount: number, tx = `tx${ledger}`): AssetOp => ({ ledger, at, tx, side, amount: BigInt(Math.round(amount * 10_000_000)), });
const fresh = () => emptyAssetState("2026-10-17");

const P0 = pt(100, "2026-10-10T10:00:00Z", 1000);
const Q = pt(200, "2026-10-12T10:00:00Z", 1013);
const OPS: AssetOp[] = [
  aop(100, "2026-10-10T10:00:00Z", "mint", 99), // at the first point: already in its supply, not in the interval
  aop(120, "2026-10-10T12:00:00Z", "mint", 10),
  aop(150, "2026-10-11T01:00:00Z", "burn", 4),
  aop(190, "2026-10-12T09:00:00Z", "mint", 6),
  aop(200, "2026-10-12T10:00:00Z", "mint", 1), // at the closing point: included
  aop(201, "2026-10-12T10:00:05Z", "mint", 50), // after it: belongs to the next interval
];

describe("R1: ops are split at point ledgers and summed per day", () => {
  const first = advance(fresh(), [P0], [], []).state;
  const { state, unreconciled } = advance(first, [Q], OPS, []);

  it("closes one explained interval with the right per-day sums", () => {
    expect(unreconciled).toEqual([]);
    expect(state.intervals).toHaveLength(1);
    const iv = state.intervals[0];
    expect(iv.explained).toBe(true);
    expect(Object.fromEntries(Object.entries(iv.by_day).map(([d, v]) => [d, [v.minted, v.burned, v.ops]]))).toEqual({
      "2026-10-10": [A(10), A(0), 1], "2026-10-11": [A(0), A(4), 1], "2026-10-12": [A(7), A(0), 2],
    });
    expect(state.open?.from_point).toEqual(Q);
    expect(state.open?.by_day["2026-10-12"].minted).toBe(A(50)); // op at ledger 201 opens the next interval
    expect(state.points).toEqual([P0, Q]);
  });

  it("supply_end of a day inside one interval subtracts the same interval's later days", () => {
    const c = completeDays(state, ["2026-10-11"]);
    expect(c.missing).toEqual([]);
    expect(c.days).toEqual([{ date: "2026-10-11", minted: A(0), burned: A(4), supply_end: A(1006), ops: 1, top_tx: [{ tx: "tx150", side: "burn", amount: A(4) }] }]);
  });

  it("is not changed by feeding ops in a different order, and ops are added once", () => {
    const shuffled = advance(first, [Q], [...OPS].reverse(), []).state;
    expect(shuffled).toEqual(state);
  });

  it("an op before the first point has no anchor and is dropped", () => {
    const s = advance(fresh(), [P0], [aop(50, "2026-10-09T10:00:00Z", "mint", 5)], []).state;
    expect(s.open).toEqual({ from_point: P0, by_day: {}, unclassified: 0 });
  });

  it("a day spanning two intervals sums both, and supply_end comes from the interval that holds the day's end", () => {
    const s1 = advance(first, [pt(130, "2026-10-10T15:00:00Z", 1010)], OPS.slice(0, 2), []).state; // P0 -> 1010 (mint 10)
    const s2 = advance(s1, [pt(180, "2026-10-11T23:00:00Z", 1006)], OPS.slice(2, 3), []).state; // -> 1006 (burn 4)
    const s3 = advance(s2, [pt(205, "2026-10-12T00:10:00Z", 1006 + 2)], [aop(203, "2026-10-12T00:05:00Z", "mint", 2)], []).state;
    const c = completeDays(s3, ["2026-10-11"]);
    // day 10-11 starts inside interval 2? Interval 1 ends 10-10T15:00, interval 2 runs 10-10T15:00..10-11T23:00, interval 3 closes after the day's end
    expect(c.days[0]).toMatchObject({ date: "2026-10-11", minted: A(0), burned: A(4), supply_end: A(1006) });
  });
});

describe("R2: explained and unexplained intervals", () => {
  const first = advance(fresh(), [P0], [], []).state;

  it("an unexplained interval gives one unreconciled entry and its days are not_reconciled", () => {
    const missingOp = OPS.filter((o) => o.ledger !== 150); // the burn of 4 is not seen
    const { state, unreconciled } = advance(first, [Q], missingOp, []);
    expect(state.intervals[0].explained).toBe(false);
    expect(unreconciled).toEqual([{ from: P0, to: Q, observed: 13n * 10_000_000n, classified: 17n * 10_000_000n }]);
    expect(completeDays(state, ["2026-10-11"])).toEqual({ days: [], missing: [{ date: "2026-10-11", reason: "not_reconciled" }] });
  });

  it("an unclassified op is counted but the equality alone decides", () => {
    const { state } = advance(first, [Q], OPS, [{ ledger: 160, at: "2026-10-11T03:00:00Z", tx: "u" }]);
    expect(state.intervals[0]).toMatchObject({ explained: true, unclassified: 1 });
  });

  it("a point from a checks file is used only when no op of the asset is near its time", () => {
    const rows = [
      { supply: A(1000), at: "2026-10-10T10:00:00Z" },
      { supply: A(1010), at: "2026-10-10T15:00:00Z" },
    ];
    const near = anchoredPoints(rows, ["2026-10-10T10:01:00Z"]); // 60 s after the first reading: inside [t-120, t+60]
    expect(near.map((p) => p.at)).toEqual(["2026-10-10T15:00:00.000Z"]);
    const late = anchoredPoints(rows, ["2026-10-10T10:01:01Z"]); // 61 s after: outside
    expect(late).toHaveLength(2);
    const early = anchoredPoints(rows, ["2026-10-10T09:58:00Z"]); // exactly 120 s before: inside
    expect(early).toHaveLength(1);
    expect(anchoredPoints([{ supply: "12", at: "2026-10-10T10:00:00Z" }], [])).toEqual([]); // not a 7-decimal amount
    expect(late[0]).toEqual({ ledger: null, at: "2026-10-10T10:00:00.000Z", supply: A(1000), source: "checks" });
  });

  it("anchored points close intervals by time, then the precise point closes the last one", () => {
    const anchors = anchoredPoints([{ supply: A(1000), at: "2026-10-10T10:00:00Z" }, { supply: A(1010), at: "2026-10-10T15:00:00Z" }], []);
    const { state } = advance(fresh(), [...anchors, pt(200, "2026-10-12T10:00:00Z", 1013)], OPS.slice(1, 5), []);
    expect(state.intervals.map((i) => i.explained)).toEqual([true, true]);
    expect(state.intervals[0].by_day).toEqual({ "2026-10-10": expect.objectContaining({ minted: A(10) }) }); // 12:00 mint is inside 10:00..15:00
  });
});

describe("R3: coverage", () => {
  it("a precise point beyond the issuer's op coverage is not usable; an anchored one needs its time inside the span", () => {
    const cov = { from: "2026-10-09T00:00:00Z", through_ledger: 150, through_at: "2026-10-11T00:00:00Z" };
    const points = [pt(100, "2026-10-10T10:00:00Z", 1), pt(151, "2026-10-11T10:00:00Z", 1), pt(null, "2026-10-10T05:00:00Z", 1, "checks"), pt(null, "2026-10-08T05:00:00Z", 1, "checks"), pt(null, "2026-10-11T05:00:00Z", 1, "checks")];
    expect(usablePoints(points, cov).map((p) => p.at)).toEqual(["2026-10-10T10:00:00Z", "2026-10-10T05:00:00Z"]);
    expect(usablePoints(points, { from: null, through_ledger: null, through_at: null })).toEqual([]);
  });

  it("days after the last point are not_covered, and days before the first point are never complete", () => {
    const first = advance(fresh(), [P0], [], []).state;
    const { state } = advance(first, [Q], OPS, []);
    const c = completeDays(state, ["2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13"]);
    expect(c.days.map((d) => d.date)).toEqual(["2026-10-11"]);
    expect(c.missing).toEqual([
      { date: "2026-10-09", reason: "not_covered" }, { date: "2026-10-10", reason: "not_covered" },
      { date: "2026-10-12", reason: "not_covered" }, { date: "2026-10-13", reason: "not_covered" },
    ]);
    expect(completeDays(fresh(), ["2026-10-11"]).missing).toEqual([{ date: "2026-10-11", reason: "not_covered" }]);
  });

  it("a quiet day inside an explained interval is complete with zero sums", () => {
    const a = advance(fresh(), [pt(1, "2026-10-01T00:00:00Z", 5)], [], []).state;
    const b = advance(a, [pt(9, "2026-10-04T00:00:00Z", 5)], [], []).state;
    expect(completeDays(b, ["2026-10-02"]).days[0]).toMatchObject({ minted: A(0), burned: A(0), supply_end: A(5), ops: 0, top_tx: [] });
  });

  it("keeps at most 40 points and 40 intervals", () => {
    let s = advance(fresh(), [pt(1, "2026-01-01T00:00:00Z", 1)], [], []).state;
    for (let i = 2; i <= 60; i++) s = advance(s, [pt(i, `2026-01-01T00:${String(i).padStart(2, "0")}:00Z`, 1)], [], []).state;
    expect(s.points).toHaveLength(40);
    expect(s.intervals).toHaveLength(40);
    expect(s.points.at(-1)?.ledger).toBe(60);
  });
});

describe("top transactions", () => {
  it("merge by tx and side, largest first, ties by hash, at most 5", () => {
    const m = mergeTop(
      [{ tx: "b", side: "mint", amount: A(5) }, { tx: "a", side: "mint", amount: A(5) }],
      [{ tx: "b", side: "mint", amount: A(1) }, ...["c", "d", "e", "f"].map((tx) => ({ tx, side: "burn" as const, amount: A(2) }))],
    );
    expect(m.map((t) => `${t.tx}:${t.amount}`)).toEqual([`b:${A(6)}`, `a:${A(5)}`, `c:${A(2)}`, `d:${A(2)}`, `e:${A(2)}`]);
  });
});
