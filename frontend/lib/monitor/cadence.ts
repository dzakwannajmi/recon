/**
 * Re-check schedule (D-047, spec 4.6). Pure: the same inputs always give the same plan, and the
 * clock is an argument. The LLM budget is zero: nothing here imports a model. The plan only decides
 * WHEN the existing pipeline runs; flags and statuses come from the deciders over the new files.
 */
import { positiveInt } from "../env";
import type { IssuerEvent, PendingEvent } from "./types";

const HOUR = 3_600_000;
const MINUTE = 60_000;
export const NORMAL_HOURS = 24;
export const HOT_HOURS = 12;
export const HOT_DAYS = 7;
/** No re-check from 23:45 to 00:15 UTC. */
export const MIDNIGHT_START_MIN = 23 * 60 + 45;
export const MIDNIGHT_END_MIN = 15;

export type Limits = { maxRunsPerDay: number; minGapMinutes: number; maxRequests: number; maxPagesPerIssuer: number };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The four MONITOR_* settings, each with a default and a hard maximum (a typo can never raise a cap). */
export function monitorLimits(): Limits {
  return {
    maxRunsPerDay: clamp(positiveInt("MONITOR_MAX_RUNS_PER_DAY", 2), 1, 4),
    minGapMinutes: clamp(positiveInt("MONITOR_MIN_GAP_MINUTES", 120), 30, 720),
    maxRequests: clamp(positiveInt("MONITOR_MAX_REQUESTS", 300), 1, 1000),
    maxPagesPerIssuer: clamp(positiveInt("MONITOR_MAX_PAGES_PER_ISSUER", 60), 1, 200),
  };
}

export const HOT_FLAGS = ["FLAG_CHANGE", "SIGNER_CHANGE", "LARGE_MINT_BURN"] as const;

/** Hot = an event for the asset in the last 7 days, or a raised change or issuance flag in the newest status. */
export function tier(args: { asset: string; events: readonly IssuerEvent[]; raisedFlags: readonly string[]; now: Date }): "hot" | "normal" {
  const since = args.now.getTime() - HOT_DAYS * 24 * HOUR;
  const recentEvent = args.events.some((e) => e.assets.includes(args.asset) && Date.parse(e.ledger_closed_at) >= since);
  return recentEvent || args.raisedFlags.some((f) => (HOT_FLAGS as readonly string[]).includes(f)) ? "hot" : "normal";
}

/** When the asset's re-check is due: its last chain check plus 12 h (hot) or 24 h. Null chain check = due now (epoch). */
export function dueAt(chainCheckedAt: string | null, t: "hot" | "normal"): Date {
  if (!chainCheckedAt) return new Date(0);
  return new Date(Date.parse(chainCheckedAt) + (t === "hot" ? HOT_HOURS : NORMAL_HOURS) * HOUR);
}

export type CadenceAsset = { asset: string; code: string; chainCheckedAt: string | null; tier: "hot" | "normal" };

export type DeferReason = "dry_run" | "no_recheck" | "midnight" | "frozen" | "budget_day" | "min_gap";

export type Plan = {
  run: boolean;
  day: string;
  reasons: string[];
  deferred?: { reason: DeferReason; until: string | null };
};

export type PlanInput = {
  now: Date;
  assets: readonly CadenceAsset[];
  /** Events not yet covered by a newer chain check. */
  pending: readonly PendingEvent[];
  /** Re-checks already started today (UTC): outcome ran or failed. */
  runsToday: number;
  lastRunAt: string | null;
  /** Any of today's four target files is frozen by a published status. */
  frozenToday: boolean;
  flags: { dryRun?: boolean; noRecheck?: boolean; forced?: boolean };
  limits: Pick<Limits, "maxRunsPerDay" | "minGapMinutes">;
};

const dayStart = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/** The first run after 00:15 UTC of the next day. */
const nextDayOpen = (now: Date) => new Date(dayStart(now) + 24 * HOUR + MIDNIGHT_END_MIN * MINUTE).toISOString();

export function planRun(i: PlanInput): Plan {
  const day = new Date(dayStart(i.now)).toISOString().slice(0, 10);
  const reasons = [
    ...i.pending.map((p) => `event:${p.event_id}`),
    ...i.assets.filter((a) => i.now.getTime() >= dueAt(a.chainCheckedAt, a.tier).getTime()).map((a) => `schedule:${a.code}`),
    ...(i.flags.forced ? ["forced"] : []),
  ];
  if (reasons.length === 0) return { run: false, day, reasons };
  const defer = (reason: DeferReason, until: string | null): Plan => ({ run: false, day, reasons, deferred: { reason, until } });

  if (i.flags.dryRun) return defer("dry_run", null);
  if (i.flags.noRecheck) return defer("no_recheck", null);
  const minutes = i.now.getUTCHours() * 60 + i.now.getUTCMinutes();
  if (minutes >= MIDNIGHT_START_MIN) return defer("midnight", nextDayOpen(i.now));
  if (minutes < MIDNIGHT_END_MIN) return defer("midnight", new Date(dayStart(i.now) + MIDNIGHT_END_MIN * MINUTE).toISOString());
  if (i.frozenToday) return defer("frozen", nextDayOpen(i.now));
  if (i.runsToday >= i.limits.maxRunsPerDay) return defer("budget_day", nextDayOpen(i.now));
  if (!i.flags.forced && i.lastRunAt) {
    const earliest = Date.parse(i.lastRunAt) + i.limits.minGapMinutes * MINUTE;
    if (i.now.getTime() < earliest) return defer("min_gap", new Date(earliest).toISOString());
  }
  return { run: true, day, reasons };
}
