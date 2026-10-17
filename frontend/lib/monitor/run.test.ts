import { createHash } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { flagLargeMintBurn } from "../flags/monitor";
import { monitorLimits, type Limits } from "./cadence";
import { copyDemoData, freshenChecks, recordingExec, syntheticHorizon, type FakeHorizon, type Scenario } from "./demo";
import { mintBurnInputFor, parseIssuance } from "./issuance";
import { runMonitor, type MonitorFlags, type RunResult } from "./run";
import { acquireLock, loadState, readLog } from "./state";
import type { IssuerEvent, RunRecord } from "./types";

const REAL = path.join(process.cwd(), "..", "data");
const ETHERFUSE = "GCRYUGD5NVARGXT56XEZI5CIFCQETYHAPQQTHO2O3IQZTHDH4LATMYWC";
const USTRY = `USTRY:${ETHERFUSE}`;
const NOW = new Date("2026-10-17T10:00:00Z");
const LIMITS: Limits = { maxRunsPerDay: 2, minGapMinutes: 120, maxRequests: 300, maxPagesPerIssuer: 60 };

const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true }); });

function setup(scenario: Scenario = {}, now = NOW, maxRequests = 300) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mon-run-"));
  roots.push(root);
  const dataDir = copyDemoData(REAL, root);
  freshenChecks(dataDir, new Date(now.getTime() - 3_600_000)); // checks look one hour old: only events make a re-check due
  const { horizon, opIds } = syntheticHorizon(dataDir, now, scenario, maxRequests);
  const rec = recordingExec();
  const lines: string[] = [];
  const go = (at: Date, flags: MonitorFlags = {}, h: FakeHorizon = horizon, limits: Limits = LIMITS): Promise<RunResult> =>
    runMonitor({ now: at, dataDir, flags, limits }, { horizon: h, exec: rec.exec, log: (l) => lines.push(l), frontendDir: "/repo/frontend", synthetic: true });
  const mdir = path.join(dataDir, "monitor");
  return { root, dataDir, mdir, horizon, opIds, rec, lines, go };
}

/** SHA-256 of every file under a folder, by relative path. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out[path.relative(dir, p)] = createHash("sha256").update(fs.readFileSync(p)).digest("hex");
    }
  };
  walk(dir);
  return out;
}

const events = (mdir: string) => readLog(mdir).filter((r): r is IssuerEvent => r.kind === "event");
const runs = (mdir: string) => readLog(mdir).filter((r): r is RunRecord => r.kind === "run");

describe("E1: a simulated set_options on a pinned issuer triggers a re-check in the same run", () => {
  it("logs an issuer_options event and a run with the event as a reason, calls the pipeline once for today, and clears the pending entry", async () => {
    const t = setup({ setOptionsFor: ETHERFUSE });
    const r = await t.go(NOW);
    expect(r.exitCode).toBe(0);

    const ev = events(t.mdir).filter((e) => e.type === "issuer_options");
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ issuer: ETHERFUSE, op_id: t.opIds.setOptions, changes: [expect.stringContaining("signer GAQW5UGB7IFES4R4HZ7PGEX5ZJ336QYX5LKQ6N7K7DPXMJZGKNXB4UHG weight 2")], synthetic: true });
    expect(ev[0].assets).toEqual(["USTRY", "TESOURO", "EUROB", "KTB", "GILTS"].map((c) => `${c}:${ETHERFUSE}`));

    const run = runs(t.mdir);
    expect(run).toHaveLength(1);
    expect(run[0].reasons).toContain(`event:${ev[0].id}`);
    expect(run[0]).toMatchObject({ kind: "run", day: "2026-10-17", outcome: "ran", partial_issuers: [] });
    expect(run[0].steps?.map((s) => [s.step, s.exit_code])).toEqual([["check:assets", 0], ["examine", 0], ["status", 0]]);

    expect(t.rec.calls.map((c) => c.args)).toEqual([["scripts/check-assets.ts", "--day", "2026-10-17"], ["scripts/examine.ts", "--day", "2026-10-17"], ["scripts/status.ts", "--as-of", "2026-10-17"]]);
    expect(loadState(t.mdir).pending).toEqual([]);

    // the issuance file for today was written before the pipeline
    const file = path.join(t.root, "data", "monitor", "issuance", "2026-10-17.json");
    expect(parseIssuance(JSON.parse(fs.readFileSync(file, "utf8"))).day).toBe("2026-10-17");
    expect(run[0].files?.map((f) => f.path)).toEqual(["data/monitor/issuance/2026-10-17.json"]);
    expect(fs.existsSync(path.join(t.mdir, ".lock"))).toBe(false);
    expect(t.lines.join("\n")).toMatch(/set_options by issuer GCRYUG…MYWC .*signer GAQW5U…4UHG weight 2/);
  });

  it("the same event is not logged twice when the same ops are read again", async () => {
    const t = setup({ setOptionsFor: ETHERFUSE });
    await t.go(NOW);
    // a lost cursor means a backfill reads the same op again: same id, no second event
    const state = loadState(t.mdir);
    delete state.issuers[ETHERFUSE];
    fs.writeFileSync(path.join(t.mdir, "state.json"), JSON.stringify(state));
    await t.go(new Date(NOW.getTime() + 3 * 3_600_000), {}, t.horizon.later(65_000_100, "2026-10-17T13:00:00Z"));
    expect(events(t.mdir).filter((e) => e.type === "issuer_options")).toHaveLength(1);
  });

  it("child output is shown to the operator and never written to the log", async () => {
    const t = setup({ setOptionsFor: ETHERFUSE });
    await t.go(NOW);
    expect(t.lines.some((l) => l.startsWith("would run: tsx scripts/check-assets.ts"))).toBe(true);
    expect(fs.readFileSync(path.join(t.mdir, "log.json"), "utf8")).not.toContain("would run");
  });

  it("names the unpublished day files a re-check replaces", async () => {
    const t = setup({ setOptionsFor: ETHERFUSE });
    const dir = path.join(t.dataDir, "checks");
    fs.copyFileSync(path.join(dir, fs.readdirSync(dir)[0]), path.join(dir, "2026-10-17.json")); // an unpublished file of today
    await t.go(NOW);
    expect(t.lines.join("\n")).toContain("Day files of 2026-10-17 that this re-check replaces (none was published): data/checks/2026-10-17.json");
  });

  it("with no event and no schedule due, nothing runs: a watch_only record", async () => {
    const t = setup();
    const r = await t.go(NOW);
    expect(r.exitCode).toBe(0);
    expect(t.rec.calls).toHaveLength(0);
    expect(runs(t.mdir)[0]).toMatchObject({ outcome: "watch_only", reasons: [] });
    expect(t.lines.join("\n")).toContain("No re-check due.");
  });

  it("a schedule reason makes a stale check due, naming the asset code", async () => {
    const t = setup();
    freshenChecks(t.dataDir, new Date(NOW.getTime() - 30 * 3_600_000));
    const r = await t.go(NOW);
    expect(r.run?.reasons).toContain("schedule:USTRY");
    expect(t.rec.calls).toHaveLength(3);
  });

  it("a failed pipeline step is a failed run with exit 3 and stops after that step", async () => {
    const t = setup({ setOptionsFor: ETHERFUSE });
    const failing = recordingExec({ "scripts/examine.ts": 9 });
    const r = await runMonitor({ now: NOW, dataDir: t.dataDir, flags: {}, limits: LIMITS }, { horizon: t.horizon, exec: failing.exec, log: () => {}, frontendDir: "/repo/frontend", synthetic: true });
    expect(r.exitCode).toBe(3);
    expect(runs(t.mdir)[0]).toMatchObject({ outcome: "failed" });
    expect(failing.calls).toHaveLength(2);
    expect(loadState(t.mdir).pending).toHaveLength(1); // not covered yet: it stays
  });
});

describe("E2: today's files are frozen", () => {
  const freezeToday = (dataDir: string, day: string) => {
    fs.writeFileSync(path.join(dataDir, "status", `${day}.json`), JSON.stringify({
      inputs: { checks: { path: `data/checks/${day}.json`, sha256: "a" }, previous_checks: null, examinations: null }, assets: [],
    }));
    const logFile = path.join(dataDir, "feed", "log.json");
    const log = JSON.parse(fs.readFileSync(logFile, "utf8")) as unknown[];
    fs.writeFileSync(logFile, JSON.stringify([...log, { status_file: `data/status/${day}.json` }]));
  };

  it("defers with reason frozen until the next day 00:15 UTC, keeps the pending event, and runs it after 00:15", async () => {
    const t = setup({ setOptionsFor: ETHERFUSE });
    freezeToday(t.dataDir, "2026-10-17");
    const r = await t.go(NOW);
    expect(t.rec.calls).toHaveLength(0);
    expect(r.run).toMatchObject({ outcome: "deferred", deferred: { reason: "frozen", until: "2026-10-18T00:15:00.000Z" } });
    expect(runs(t.mdir)[0].reasons[0]).toMatch(/^event:/);
    expect(loadState(t.mdir).pending).toHaveLength(1);

    const next = new Date("2026-10-18T00:20:00Z");
    const r2 = await t.go(next, {}, t.horizon.later(65_001_000, "2026-10-18T00:20:00Z"));
    expect(r2.run?.outcome).toBe("ran");
    expect(t.rec.calls.map((c) => c.args)).toContainEqual(["scripts/status.ts", "--as-of", "2026-10-18"]);
    expect(loadState(t.mdir).pending).toEqual([]);
  });

  it("a log record that names a status file that does not exist is a refusal (exit 1) and writes nothing", async () => {
    const t = setup({ setOptionsFor: ETHERFUSE });
    const logFile = path.join(t.dataDir, "feed", "log.json");
    fs.writeFileSync(logFile, JSON.stringify([{ status_file: "data/status/gone.json" }]));
    const before = snapshot(t.root);
    const r = await t.go(NOW);
    expect(r.exitCode).toBe(1);
    expect(t.lines.join("\n")).toMatch(/gone\.json/);
    expect(snapshot(t.root)).toEqual(before);
  });
});

describe("E3: a simulated large intraday mint", () => {
  it("raises a large_mint_burn event and a run in the same call", async () => {
    const t = setup({ largeMintShare: { issuer: ETHERFUSE, percent: 30 } });
    const r = await t.go(NOW);
    const large = events(t.mdir).filter((e) => e.type === "large_mint_burn");
    expect(large).toHaveLength(1);
    expect(large[0]).toMatchObject({ side: "mint", assets: [USTRY], synthetic: true });
    expect(Number(large[0].share)).toBeGreaterThan(20);
    expect(r.run?.reasons).toContain(`event:${large[0].id}`);
    expect(t.rec.calls).toHaveLength(3);
    // the supply change is explained by the classified mint, so there is no unreconciled event
    expect(events(t.mdir).filter((e) => e.type === "supply_unreconciled")).toEqual([]);
  });

  it("a day is complete once a point before it and a point after it close explained intervals", async () => {
    const t = setup({ largeMintShare: { issuer: ETHERFUSE, percent: 30 } });
    // The evening before: a point exists before 2026-10-17 starts.
    const evening = new Date("2026-10-16T18:00:00Z");
    const before = syntheticHorizon(t.dataDir, evening, {}).horizon.later(64_990_000, "2026-10-16T18:00:00Z");
    await t.go(evening, { noRecheck: true }, before);
    await t.go(NOW, {});
    await t.go(new Date("2026-10-18T00:30:00Z"), { forced: true }, t.horizon.later(65_002_000, "2026-10-18T00:30:00Z"));
    const file = parseIssuance(JSON.parse(fs.readFileSync(path.join(t.root, "data", "monitor", "issuance", "2026-10-18.json"), "utf8")));
    const input = mintBurnInputFor(file, USTRY)!;
    expect(input.days.map((d) => d.date)).toEqual(["2026-10-17"]);
    expect(input.missing).toContain("2026-10-16");
    const e = flagLargeMintBurn(input, "2026-10-18");
    expect(e).toMatchObject({ outcome: "raised", severity: "WARNING", as_of: "2026-10-18" });
    expect(e.outcome === "raised" && e.statement).toMatch(/^Single-day mint of \d+(\.\d+)? on 2026-10-17 is 23\.\d+% of supply/);
    expect(events(t.mdir).filter((x) => x.type === "supply_unreconciled")).toEqual([]);
  });
});

describe("E4: budgets", () => {
  it("a third trigger on the same day is deferred with budget_day, and the two earlier runs happened", async () => {
    const t = setup();
    expect((await t.go(NOW, { forced: true })).run?.outcome).toBe("ran");
    expect((await t.go(new Date(NOW.getTime() + 3 * 3_600_000), { forced: true }, t.horizon.later(65_000_500, "2026-10-17T13:00:00Z"))).run?.outcome).toBe("ran");
    const third = await t.go(new Date(NOW.getTime() + 6 * 3_600_000), { forced: true }, t.horizon.later(65_001_000, "2026-10-17T16:00:00Z"));
    expect(third.run).toMatchObject({ outcome: "deferred", deferred: { reason: "budget_day", until: "2026-10-18T00:15:00.000Z" } });
    expect(t.rec.calls).toHaveLength(6);
  });

  it("an event inside the 120-minute gap is deferred with min_gap until the gap has passed", async () => {
    const t = setup();
    await t.go(NOW, { forced: true });
    const at = new Date("2026-10-17T10:30:00Z");
    const t2 = syntheticHorizon(t.dataDir, at, { setOptionsFor: ETHERFUSE }, 300, 65_000_900);
    const r = await t.go(at, {}, t2.horizon);
    expect(r.run).toMatchObject({ outcome: "deferred", deferred: { reason: "min_gap", until: "2026-10-17T12:00:00.000Z" } });
    expect(t.rec.calls).toHaveLength(3);
  });

  it("the 120-minute gap counts a re-check of the day before (23:40, then 00:20 is 40 minutes)", async () => {
    const t = setup();
    await t.go(new Date("2026-10-16T23:40:00Z"), { forced: true }, syntheticHorizon(t.dataDir, new Date("2026-10-16T23:40:00Z"), {}, 300, 64_990_000).horizon);
    const at = new Date("2026-10-17T00:20:00Z");
    freshenChecks(t.dataDir, new Date("2026-10-16T23:00:00Z")); // so the event at 00:00 is newer than the newest check
    const t2 = syntheticHorizon(t.dataDir, at, { setOptionsFor: ETHERFUSE }, 300, 65_000_900);
    const r = await t.go(at, {}, t2.horizon);
    expect(r.run).toMatchObject({ outcome: "deferred", deferred: { reason: "min_gap", until: "2026-10-17T01:40:00.000Z" } });
    expect(t.rec.calls).toHaveLength(3); // only the first run's steps
  });

  it("requests stop at the budget: some issuers are partial, the state is saved, exit 2", async () => {
    const t = setup({}, NOW, 60); // 55 requests for the supply points, 5 left
    const r = await t.go(NOW, { noRecheck: true });
    expect(r.exitCode).toBe(2);
    expect(t.horizon.requests).toBeLessThanOrEqual(60);
    const run = runs(t.mdir)[0];
    expect(run.partial_issuers.length).toBeGreaterThan(5);
    expect(run.horizon_requests).toBe(t.horizon.requests);
    expect(Object.keys(loadState(t.mdir).issuers).length).toBeGreaterThan(0);
  });

  it("a locked data folder refuses to start (exit 1)", async () => {
    const t = setup();
    fs.mkdirSync(t.mdir, { recursive: true });
    const release = acquireLock(t.mdir, NOW);
    fs.utimesSync(path.join(t.mdir, ".lock"), NOW, NOW); // the test clock is fixed: age the lock against it
    const r = await t.go(NOW);
    expect(r.exitCode).toBe(1);
    expect(t.lines.join("\n")).toContain("already running");
    release();
  });
});

describe("E5: dry runs and replays leave the data folder byte-identical", () => {
  it("--dry-run reads Horizon, prints the plan, writes nothing, runs nothing", async () => {
    const t = setup({ setOptionsFor: ETHERFUSE });
    const before = snapshot(t.root);
    const r = await t.go(NOW, { dryRun: true });
    expect(snapshot(t.root)).toEqual(before);
    expect(t.rec.calls).toHaveLength(0);
    expect(r.exitCode).toBe(0);
    expect(r.plan).toMatchObject({ run: false, deferred: { reason: "dry_run" } });
    expect(t.lines.join("\n")).toContain("would re-check USTRY, TESOURO, EUROB, KTB, GILTS");
    expect(t.lines.join("\n")).toContain("Dry run: nothing was written and nothing was run.");
  });

  it("--replay-from prints the issuer event with a link and the re-check line, and writes nothing", async () => {
    const t = setup({ setOptionsFor: ETHERFUSE, largeMintShare: { issuer: ETHERFUSE, percent: 5 } });
    const before = snapshot(t.root);
    const r = await t.go(NOW, { replayFrom: "2026-10-16", replayIssuers: [ETHERFUSE] });
    expect(snapshot(t.root)).toEqual(before);
    expect(t.rec.calls).toHaveLength(0);
    expect(r.exitCode).toBe(0);
    const text = t.lines.join("\n");
    expect(text).toMatch(/EVENT issuer_options: set_options by issuer GCRYUG…MYWC at ledger \d+ \(2026-10-17T09:40:00Z\): signer GAQW5U…4UHG weight 2/);
    expect(text).toMatch(/https:\/\/stellar\.expert\/explorer\/public\/tx\/5ea1ed01/);
    expect(text).toContain("would re-check USTRY, TESOURO, EUROB, KTB, GILTS");
    expect(text).toContain(`${USTRY}: classified daily mint and burn sums (not reconciled with supply)`);
  });

  it("--replay-from refuses a bad date and an issuer that is not pinned (exit 1)", async () => {
    const t = setup();
    expect((await t.go(NOW, { replayFrom: "2026-02-30" })).exitCode).toBe(1);
    expect((await t.go(NOW, { replayFrom: "2026-10-16", replayIssuers: ["GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"] })).exitCode).toBe(1);
  });

  it("--lookback-hours exits 5 when an event is found and 0 when not, and writes nothing", async () => {
    const t = setup({ setOptionsFor: ETHERFUSE });
    const before = snapshot(t.root);
    expect((await t.go(NOW, { lookbackHours: 3 })).exitCode).toBe(5);
    expect((await t.go(NOW, { lookbackHours: 48 })).exitCode).toBe(5);
    expect(snapshot(t.root)).toEqual(before);
    expect((await t.go(NOW, { lookbackHours: 0 })).exitCode).toBe(1);
    expect((await t.go(NOW, { lookbackHours: 49 })).exitCode).toBe(1);
    const quiet = setup();
    expect((await quiet.go(NOW, { lookbackHours: 6 })).exitCode).toBe(0);
    expect(t.rec.calls).toHaveLength(0);
  });

  it("warns when the newest published chain check is older than six days", async () => {
    const t = setup();
    const r = await t.go(new Date("2026-10-25T10:00:00Z"), { dryRun: true });
    expect(r.exitCode).toBe(0);
    expect(t.lines.join("\n")).toMatch(/Newest published chain check: 2026-10-15T.* \(9\.\d days ago\)\. Notice: older than 6 days\./);
    const fresh = setup();
    await fresh.go(NOW, { dryRun: true });
    expect(fresh.lines.join("\n")).not.toContain("Notice:");
  });
});

describe("the Monitor's own wording", () => {
  it("never uses a judgment word in its output or its log", async () => {
    const t = setup({ setOptionsFor: ETHERFUSE, largeMintShare: { issuer: ETHERFUSE, percent: 30 } });
    await t.go(NOW);
    const all = t.lines.join("\n") + fs.readFileSync(path.join(t.mdir, "log.json"), "utf8");
    expect(all).not.toMatch(/\b(unsafe|risky|fraud\w*|scam\w*|suspicious|rating|score|grade|price)\b/i);
  });

  it("reads its limits from the four MONITOR_* names only", () => {
    expect(monitorLimits()).toMatchObject({ maxRunsPerDay: 2, minGapMinutes: 120, maxRequests: 300 });
  });
});
