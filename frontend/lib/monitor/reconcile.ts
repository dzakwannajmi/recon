/**
 * Reconciliation (D-047, spec 4.4). Pure. The classified mint and burn sums between two supply
 * points must equal the supply difference exactly (stroops) before a day can count. A day that
 * cannot be proven is `missing`, never zero: the decider turns that into not_evaluated.
 */
import { formatStroops, toStroops } from "../chain/asset";
import { MAX_INTERVALS, MAX_POINTS, type AssetState, type DayAgg, type Interval, type MissingDay, type Point, type TopTx } from "./types";

export type AssetOp = { ledger: number; at: string; tx: string; side: "mint" | "burn"; amount: bigint };
export type UnclassifiedOp = { ledger: number; at: string; tx: string };

const DAY_MS = 86_400_000;
export const dayOf = (iso: string) => iso.slice(0, 10);
const ms = (iso: string) => Date.parse(iso);
const ZERO = formatStroops(0n);

export const emptyAssetState = (today: string): AssetState => ({
  points: [], intervals: [], open: null, intraday: { date: today, minted: ZERO, burned: ZERO }, large_seen: [],
});

/** A point is later than a base: by ledger when both are precise, else by time. */
export function pointAfter(p: Point, base: Point): boolean {
  return p.ledger !== null && base.ledger !== null ? p.ledger > base.ledger : ms(p.at) > ms(base.at);
}
const cmpPoint = (a: Point, b: Point) => (pointAfter(a, b) ? 1 : pointAfter(b, a) ? -1 : 0);

/** An op lies after a point (strictly) / up to and including it. */
const opAfter = (op: { ledger: number; at: string }, p: Point) => (p.ledger !== null ? op.ledger > p.ledger : ms(op.at) > ms(p.at));
const opUpTo = (op: { ledger: number; at: string }, p: Point) => !opAfter(op, p);

const cmpTop = (a: TopTx, b: TopTx) => {
  const [x, y] = [toStroops(a.amount), toStroops(b.amount)];
  return x === y ? (a.tx < b.tx ? -1 : a.tx > b.tx ? 1 : a.side < b.side ? -1 : a.side > b.side ? 1 : 0) : x > y ? -1 : 1;
};

/** Merge top transactions (same tx and side add up), largest first, ties by hash; at most 5. */
export function mergeTop(...lists: readonly (readonly TopTx[])[]): TopTx[] {
  const m = new Map<string, bigint>();
  for (const list of lists) for (const t of list) m.set(`${t.tx}|${t.side}`, (m.get(`${t.tx}|${t.side}`) ?? 0n) + toStroops(t.amount));
  return [...m.entries()]
    .map(([k, v]) => { const [tx, side] = k.split("|"); return { tx, side: side as "mint" | "burn", amount: formatStroops(v) }; })
    .sort(cmpTop)
    .slice(0, 5);
}

function addToDay(by_day: Record<string, DayAgg>, op: AssetOp) {
  const d = dayOf(op.at);
  const cur = by_day[d] ?? { minted: ZERO, burned: ZERO, ops: 0, top_tx: [] };
  const key = op.side === "mint" ? "minted" : "burned";
  by_day[d] = {
    ...cur,
    [key]: formatStroops(toStroops(cur[key]) + op.amount),
    ops: cur.ops + 1,
    top_tx: mergeTop(cur.top_tx, [{ tx: op.tx, side: op.side, amount: formatStroops(op.amount) }]),
  };
}

/** Σ (minted − burned), in stroops, over some days of an interval. */
export const netOf = (by_day: Record<string, DayAgg>, keep: (date: string) => boolean = () => true): bigint =>
  Object.entries(by_day).filter(([d]) => keep(d)).reduce((n, [, a]) => n + toStroops(a.minted) - toStroops(a.burned), 0n);

export type Unreconciled = { from: Point; to: Point; observed: bigint; classified: bigint };

/**
 * Feed new ops (oldest first) and new supply points into one asset's state. Points must already be
 * covered by the issuer's op coverage (see `usablePoints`). Each op is added once: to the open
 * interval if it lies after the interval's start; when a point arrives, the ops up to it close the
 * interval and the next ones open the next. Ops before the first point have no anchor and are dropped.
 */
export function advance(prev: AssetState, newPoints: readonly Point[], ops: readonly AssetOp[], unclassified: readonly UnclassifiedOp[]): { state: AssetState; unreconciled: Unreconciled[] } {
  const state = structuredClone(prev);
  const unreconciled: Unreconciled[] = [];
  const sortedOps = [...ops].sort((a, b) => a.ledger - b.ledger);
  const sortedUnclassified = [...unclassified].sort((a, b) => a.ledger - b.ledger);
  let oi = 0;
  let ui = 0;

  const consume = (bound: Point | null) => {
    while (oi < sortedOps.length && (!bound || opUpTo(sortedOps[oi], bound))) {
      if (state.open && opAfter(sortedOps[oi], state.open.from_point)) addToDay(state.open.by_day, sortedOps[oi]);
      oi++;
    }
    while (ui < sortedUnclassified.length && (!bound || opUpTo(sortedUnclassified[ui], bound))) {
      if (state.open && opAfter(sortedUnclassified[ui], state.open.from_point)) state.open.unclassified++;
      ui++;
    }
  };

  for (const q of [...newPoints].sort(cmpPoint)) {
    if (state.open && !pointAfter(q, state.open.from_point)) continue;
    consume(q);
    if (state.open) {
      const observed = toStroops(q.supply) - toStroops(state.open.from_point.supply);
      const classified = netOf(state.open.by_day);
      const iv: Interval = {
        from: state.open.from_point, to: q, explained: observed === classified, unclassified: state.open.unclassified, by_day: state.open.by_day,
      };
      state.intervals.push(iv);
      if (!iv.explained) unreconciled.push({ from: iv.from, to: q, observed, classified });
    }
    state.open = { from_point: q, by_day: {}, unclassified: 0 };
    state.points.push(q);
  }
  consume(null);
  state.points = state.points.slice(-MAX_POINTS);
  state.intervals = state.intervals.slice(-MAX_INTERVALS);
  return { state, unreconciled };
}

export type Coverage = { from: string | null; through_ledger: number | null; through_at: string | null };

/**
 * Points the coverage allows. A precise point needs the issuer's ops to reach its ledger. In a backfill,
 * a point from a checks file also needs its time to lie inside the covered span.
 */
export function usablePoints(points: readonly Point[], cov: Coverage): Point[] {
  return points.filter((p) => {
    if (p.ledger !== null) return cov.through_ledger !== null && p.ledger <= cov.through_ledger;
    return cov.from !== null && cov.through_at !== null && ms(p.at) > ms(cov.from) && ms(p.at) <= ms(cov.through_at);
  });
}

/**
 * Supply readings stored in earlier checks files (backfill only). A reading is a clean boundary only
 * when no classified or unclassified op of the asset lies within 120 s before to 60 s after its time.
 */
export function anchoredPoints(readings: readonly { supply: string; at: string }[], opTimes: readonly string[]): Point[] {
  const times = opTimes.map(ms);
  return readings
    .filter((r) => /^\d+\.\d{7}$/.test(r.supply) && Number.isFinite(ms(r.at)))
    .filter((r) => !times.some((t) => t >= ms(r.at) - 120_000 && t <= ms(r.at) + 60_000))
    .map((r): Point => ({ ledger: null, at: new Date(ms(r.at)).toISOString(), supply: r.supply, source: "checks" }));
}

export type CompleteDay = { date: string; minted: string; burned: string; supply_end: string; ops: number; top_tx: TopTx[] };

/** For each day: complete (proven by a chain of explained intervals), or missing with a reason. */
export function completeDays(asset: AssetState, days: readonly string[]): { days: CompleteDay[]; missing: MissingDay[] } {
  const out: CompleteDay[] = [];
  const missing: MissingDay[] = [];
  for (const date of days) {
    const start = ms(`${date}T00:00:00Z`);
    const end = start + DAY_MS;
    const ivs = asset.intervals.filter((iv) => ms(iv.to.at) >= start && ms(iv.from.at) < end);
    const contiguous = ivs.every((iv, i) => i === 0 || ivs[i - 1].to.at === iv.from.at);
    if (ivs.length === 0 || !contiguous || ms(ivs[0].from.at) >= start || ms(ivs[ivs.length - 1].to.at) < end) {
      missing.push({ date, reason: "not_covered" });
      continue;
    }
    if (ivs.some((iv) => !iv.explained)) {
      missing.push({ date, reason: "not_reconciled" });
      continue;
    }
    const sum = (key: "minted" | "burned") => ivs.reduce((n, iv) => n + toStroops(iv.by_day[date]?.[key]), 0n);
    const closing = ivs.find((iv) => ms(iv.to.at) >= end)!;
    const supplyEnd = toStroops(closing.to.supply) - netOf(closing.by_day, (d) => d > date);
    out.push({
      date,
      minted: formatStroops(sum("minted")),
      burned: formatStroops(sum("burned")),
      supply_end: formatStroops(supplyEnd),
      ops: ivs.reduce((n, iv) => n + (iv.by_day[date]?.ops ?? 0), 0),
      top_tx: mergeTop(...ivs.map((iv) => iv.by_day[date]?.top_tx ?? [])),
    });
  }
  return { days: out, missing };
}
