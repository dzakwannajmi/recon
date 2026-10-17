/**
 * The daily issuance file `data/monitor/issuance/YYYY-MM-DD.json` (D-047, spec 4.5): the input of
 * LARGE_MINT_BURN. Pure. Only days proven by reconciliation are in `days`; every other day of the
 * window is in `missing`.
 */
import { z } from "zod";
import { HORIZON_MAINNET } from "../chain/horizon";
import type { MintBurnInput } from "../flags/monitor";
import { addDays } from "../flags/changes";
import { completeDays } from "./reconcile";
import type { IssuanceAsset, IssuanceFile, MonitorState } from "./types";

export const issuancePath = (day: string) => `data/monitor/issuance/${day}.json`;

/** JSON with object keys sorted recursively, so the same data gives the same bytes. */
export function stableJson(value: unknown, indent = 2): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, x]) => [k, sort(x)]));
    return v;
  };
  return JSON.stringify(sort(value), null, indent) + "\n";
}

/** The window of dates (oldest first): D-8 to D-1. */
export const issuanceWindow = (day: string) => Array.from({ length: 8 }, (_, i) => addDays(day, i - 8));

/** @param assetKeys the pinned assets in data/assets.csv order */
export function buildIssuance(day: string, generatedAt: string, state: MonitorState, assetKeys: readonly string[]): IssuanceFile {
  const window = issuanceWindow(day);
  const assets: IssuanceAsset[] = assetKeys.map((asset) => {
    const s = state.assets[asset];
    if (!s) return { asset, supply_points: [], intervals: [], days: [], missing: window.map((date) => ({ date, reason: "not_covered" as const })) };
    const { days, missing } = completeDays(s, window);
    return {
      asset,
      supply_points: s.points,
      intervals: s.intervals.map(({ from, to, explained, unclassified }) => ({ from, to, explained, unclassified })),
      days,
      missing,
    };
  });
  return { monitor_version: 1, generated_at: generatedAt, day, window: { from: window[0], to: window[window.length - 1] }, horizon: HORIZON_MAINNET, assets };
}

const amount = z.string().regex(/^\d+\.\d{7}$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const point = z.object({ ledger: z.number().int().nullable(), at: z.string(), supply: amount, source: z.enum(["monitor", "checks"]) }).strict();
const topTx = z.object({ tx: z.string(), side: z.enum(["mint", "burn"]), amount }).strict();

export const issuanceSchema = z.object({
  monitor_version: z.literal(1),
  generated_at: z.string(),
  day: date,
  window: z.object({ from: date, to: date }).strict(),
  horizon: z.string(),
  assets: z.array(z.object({
    asset: z.string(),
    supply_points: z.array(point),
    intervals: z.array(z.object({ from: point, to: point, explained: z.boolean(), unclassified: z.number().int() }).strict()),
    days: z.array(z.object({ date, minted: amount, burned: amount, supply_end: amount, ops: z.number().int(), top_tx: z.array(topTx) }).strict()),
    missing: z.array(z.object({ date, reason: z.enum(["not_covered", "not_reconciled"]) }).strict()),
  }).strict()),
}).strict();

/** Parse a stored issuance file; a bad file throws (the status run stops, it never guesses). */
export function parseIssuance(json: unknown): IssuanceFile {
  const parsed = issuanceSchema.safeParse(json);
  if (!parsed.success) throw new Error(`issuance file is invalid: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return parsed.data;
}

/** One asset's decider input, or null when the file has no entry for it. */
export function mintBurnInputFor(file: IssuanceFile, assetKey: string): MintBurnInput | null {
  const a = file.assets.find((x) => x.asset === assetKey);
  if (!a) return null;
  return {
    supply: a.supply_points.at(-1)?.supply ?? a.days.at(-1)?.supply_end ?? "0.0000000",
    days: a.days.map(({ date, minted, burned, supply_end }) => ({ date, minted, burned, supply_end })),
    missing: a.missing.map((m) => m.date),
    ref: `${issuancePath(file.day)}#${assetKey}`,
  };
}
