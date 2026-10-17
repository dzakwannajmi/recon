import { afterEach, describe, expect, it, vi } from "vitest";
import { dueAt, monitorLimits, planRun, tier, type CadenceAsset, type PlanInput } from "./cadence";
import { uncoveredPending } from "./events";
import type { IssuerEvent } from "./types";

const ev = (assets: string[], closed: string): IssuerEvent => ({ kind: "event", id: "x", seen_at: closed, type: "issuer_options", issuer: "G", assets, ledger: 1, ledger_closed_at: closed });
const NOW = new Date("2026-10-17T10:00:00Z");

describe("K1: tier and dueAt", () => {
  it("is hot with an event in the last 7 days or a raised change or issuance flag, else normal", () => {
    const base = { asset: "A:G", events: [] as IssuerEvent[], raisedFlags: [] as string[], now: NOW };
    expect(tier(base)).toBe("normal");
    expect(tier({ ...base, events: [ev(["A:G"], "2026-10-10T10:00:00Z")] })).toBe("hot"); // exactly 7 days
    expect(tier({ ...base, events: [ev(["A:G"], "2026-10-10T09:59:59Z")] })).toBe("normal");
    expect(tier({ ...base, events: [ev(["B:G"], "2026-10-16T10:00:00Z")] })).toBe("normal");
    for (const f of ["FLAG_CHANGE", "SIGNER_CHANGE", "LARGE_MINT_BURN"]) expect(tier({ ...base, raisedFlags: [f] }), f).toBe("hot");
    expect(tier({ ...base, raisedFlags: ["NO_PUBLIC_DOCS", "SUPPLY_MISMATCH"] })).toBe("normal");
  });

  it("due = last chain check + 24 h (normal) or 12 h (hot); no check = due now", () => {
    expect(dueAt("2026-10-16T10:00:00Z", "normal").toISOString()).toBe("2026-10-17T10:00:00.000Z");
    expect(dueAt("2026-10-16T10:00:00Z", "hot").toISOString()).toBe("2026-10-16T22:00:00.000Z");
    expect(dueAt(null, "normal").getTime()).toBe(0);
  });
});

const asset = (code: string, chainCheckedAt: string | null, t: "hot" | "normal" = "normal"): CadenceAsset => ({ asset: `${code}:G`, code, chainCheckedAt, tier: t });
const input = (over: Partial<PlanInput> = {}): PlanInput => ({
  now: NOW, assets: [asset("A", "2026-10-17T09:00:00Z")], pending: [], runsToday: 0, lastRunAt: null, frozenToday: false, flags: {},
  limits: { maxRunsPerDay: 2, minGapMinutes: 120 }, ...over,
});
const pending = { event_id: "e1", assets: ["A:G"], ledger_closed_at: "2026-10-17T09:30:00Z" };

describe("K1: planRun", () => {
  it("runs nothing when nothing is due and nothing is pending", () => {
    expect(planRun(input())).toEqual({ run: false, day: "2026-10-17", reasons: [] });
  });

  it("runs for a pending event, a due asset (naming its code), and a forced run, in that order", () => {
    const p = planRun(input({ assets: [asset("A", "2026-10-16T09:59:59Z"), asset("B", "2026-10-17T09:00:00Z")], pending: [pending], flags: { forced: true } }));
    expect(p).toEqual({ run: true, day: "2026-10-17", reasons: ["event:e1", "schedule:A", "forced"] });
  });

  it("a hot asset is due after 12 h", () => {
    const hot = planRun(input({ assets: [asset("A", "2026-10-16T21:59:00Z", "hot")] }));
    expect(hot.reasons).toEqual(["schedule:A"]);
    expect(planRun(input({ assets: [asset("A", "2026-10-16T21:59:00Z", "normal")] })).run).toBe(false);
  });

  it("refuses in order: dry_run, no_recheck, midnight, frozen, budget_day, min_gap, each with its until", () => {
    const due = { pending: [pending] };
    expect(planRun(input({ ...due, flags: { dryRun: true } })).deferred).toEqual({ reason: "dry_run", until: null });
    expect(planRun(input({ ...due, flags: { noRecheck: true } })).deferred).toEqual({ reason: "no_recheck", until: null });
    expect(planRun(input({ ...due, now: new Date("2026-10-17T23:45:00Z") })).deferred).toEqual({ reason: "midnight", until: "2026-10-18T00:15:00.000Z" });
    expect(planRun(input({ ...due, now: new Date("2026-10-17T23:44:59Z") })).run).toBe(true);
    expect(planRun(input({ ...due, now: new Date("2026-10-18T00:14:59Z") })).deferred).toEqual({ reason: "midnight", until: "2026-10-18T00:15:00.000Z" });
    expect(planRun(input({ ...due, now: new Date("2026-10-18T00:15:00Z") })).run).toBe(true);
    expect(planRun(input({ ...due, frozenToday: true })).deferred).toEqual({ reason: "frozen", until: "2026-10-18T00:15:00.000Z" });
    expect(planRun(input({ ...due, runsToday: 2 })).deferred).toEqual({ reason: "budget_day", until: "2026-10-18T00:15:00.000Z" });
    expect(planRun(input({ ...due, runsToday: 1, lastRunAt: "2026-10-17T08:30:00Z" })).deferred).toEqual({ reason: "min_gap", until: "2026-10-17T10:30:00.000Z" });
    expect(planRun(input({ ...due, runsToday: 1, lastRunAt: "2026-10-17T08:00:00Z" })).run).toBe(true); // exactly 120 min
    // order: frozen before budget_day, midnight before frozen
    expect(planRun(input({ ...due, frozenToday: true, runsToday: 2 })).deferred?.reason).toBe("frozen");
    expect(planRun(input({ ...due, frozenToday: true, now: new Date("2026-10-17T23:50:00Z") })).deferred?.reason).toBe("midnight");
    expect(planRun(input({ ...due, runsToday: 2, lastRunAt: "2026-10-17T09:59:00Z" })).deferred?.reason).toBe("budget_day");
  });

  it("--recheck-now skips min_gap only: it obeys frozen, budget_day and midnight", () => {
    const f = { forced: true };
    expect(planRun(input({ flags: f, runsToday: 1, lastRunAt: "2026-10-17T09:59:00Z" })).run).toBe(true);
    expect(planRun(input({ flags: f, frozenToday: true })).deferred?.reason).toBe("frozen");
    expect(planRun(input({ flags: f, runsToday: 2 })).deferred?.reason).toBe("budget_day");
    expect(planRun(input({ flags: f, now: new Date("2026-10-17T23:59:00Z") })).deferred?.reason).toBe("midnight");
  });
});

describe("K1: pending events", () => {
  it("an event before the newest chain check of every asset it names is covered", () => {
    const p = [{ event_id: "a", assets: ["A:G", "B:G"], ledger_closed_at: "2026-10-17T09:30:00Z" }];
    const at = (m: Record<string, string | null>) => (k: string) => m[k] ?? null;
    expect(uncoveredPending(p, at({ "A:G": "2026-10-17T09:31:00Z", "B:G": "2026-10-17T09:31:00Z" }))).toEqual([]);
    expect(uncoveredPending(p, at({ "A:G": "2026-10-17T09:31:00Z", "B:G": "2026-10-17T09:30:00Z" }))).toEqual(p); // not later
    expect(uncoveredPending(p, at({ "A:G": "2026-10-17T09:31:00Z" }))).toEqual(p); // B has no check
  });
});

describe("monitorLimits", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("defaults to 2 runs a day, 120 minutes, 300 requests, 60 pages", () => {
    expect(monitorLimits()).toEqual({ maxRunsPerDay: 2, minGapMinutes: 120, maxRequests: 300, maxPagesPerIssuer: 60 });
  });
  it("clamps to the hard maximums and minimums, and a typo falls back to the default", () => {
    vi.stubEnv("MONITOR_MAX_RUNS_PER_DAY", "99");
    vi.stubEnv("MONITOR_MIN_GAP_MINUTES", "5");
    vi.stubEnv("MONITOR_MAX_REQUESTS", "100000");
    vi.stubEnv("MONITOR_MAX_PAGES_PER_ISSUER", "12x");
    expect(monitorLimits()).toEqual({ maxRunsPerDay: 4, minGapMinutes: 30, maxRequests: 1000, maxPagesPerIssuer: 60 });
  });
});
