/**
 * The Monitor run (D-047, spec 4.1). Deterministic code decides WHEN the existing pipeline runs and
 * supplies the daily issuance input of LARGE_MINT_BURN. It never sets a status (the deciders in
 * lib/flags do), never publishes, never calls an LLM, and reads Horizon mainnet only.
 */
import fs from "fs";
import path from "path";
import { formatStroops, toStroops } from "../chain/asset";
import { loadUniverse } from "../chain/universe";
import { sha256Hex } from "../documents/store";
import { addDays, chainCheckedAt } from "../flags/changes";
import { datedFiles } from "../flags/inputs";
import { isIsoDay, type ChecksRow } from "../flags/types";
import { planRun, tier, type CadenceAsset, type Limits, type Plan } from "./cadence";
import { classifyOp, needsEffects } from "./classify";
import { describeEvent, intradayLarge, issuerChangeEvent, uncoveredPending, unreconciledEventId, updateIntraday } from "./events";
import { assertWritable, loadFrozen, targetFiles } from "./frozen";
import { assetKeyOf, type HorizonSource, type OpsRead, type PinnedAsset } from "./horizon";
import { buildIssuance, issuancePath, issuanceWindow, stableJson } from "./issuance";
import { describeDiff, diffStatus } from "./diff";
import { runPipeline, type Exec } from "./pipeline";
import { advance, anchoredPoints, completeDays, dayOf, emptyAssetState, usablePoints, type AssetOp, type UnclassifiedOp } from "./reconcile";
import { acquireLock, appendLog, LockError, loadState, readLog, saveState, writeFileAtomic } from "./state";
import { opLedger, type AssetState, type HorizonEffect, type IssuerEvent, type IssuerState, type LogRecord, type MonitorState, type PendingEvent, type RunRecord } from "./types";

export type MonitorFlags = {
  dryRun?: boolean;
  noRecheck?: boolean;
  forced?: boolean;
  /** YYYY-MM-DD: read that history and print (implies dry run). */
  replayFrom?: string;
  /** Pinned issuers to replay; all pinned issuers when empty. */
  replayIssuers?: string[];
  /** 1 to 48: read the last N hours (implies dry run; exit 5 on any event). */
  lookbackHours?: number;
};

export type RunOptions = { now: Date; dataDir: string; flags: MonitorFlags; limits: Limits };

export type RunDeps = {
  horizon: HorizonSource;
  exec?: Exec;
  /** One line of output for the operator. */
  log: (line: string) => void;
  /** The `frontend/` folder (working directory of the pipeline). */
  frontendDir: string;
  /** Marks records written by the demo. */
  synthetic?: boolean;
};

export type RunResult = { exitCode: 0 | 1 | 2 | 3 | 5; plan: Plan | null; events: IssuerEvent[]; run: RunRecord | null };

const EXPLORER_TX = "https://stellar.expert/explorer/public/tx";
/** Stale published chain check: warn above this many days (M-F4). */
const STALE_DAYS = 6;

type ChecksFile = { day: string; file: string; checked_at: string; results: Omit<ChecksRow, "file">[] };

function readChecks(dataDir: string): ChecksFile[] {
  const dir = path.join(dataDir, "checks");
  const names = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  return datedFiles(names, "9999-12-31").reverse().map((name) => {
    const json = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as { checked_at: string; results: Omit<ChecksRow, "file">[] };
    return { day: name.slice(0, 10), file: `data/checks/${name}`, checked_at: json.checked_at, results: json.results };
  });
}

type StatusFileLike = { assets: { asset: string; asset_code: string; status: string | null; flags_bitmask: number; checked_at?: string | null; raised: { flag: string }[] }[] };

function readStatus(dataDir: string, rel: string): StatusFileLike | null {
  const file = path.join(path.dirname(dataDir), rel);
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as StatusFileLike) : null;
}

function newestStatusRel(dataDir: string): string | null {
  const dir = path.join(dataDir, "status");
  const names = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  const newest = datedFiles(names, "9999-12-31")[0];
  return newest ? `data/status/${newest}` : null;
}

/** Reasons for the terminal: events in full, scheduled assets as a short list. */
export function summarizeReasons(reasons: readonly string[]): string {
  const sched = reasons.filter((r) => r.startsWith("schedule:")).map((r) => r.slice(9));
  const rest = reasons.filter((r) => !r.startsWith("schedule:"));
  const shown = sched.length > 5 ? `${sched.slice(0, 5).join(", ")} and ${sched.length - 5} more` : sched.join(", ");
  return [...rest, ...(sched.length ? [`schedule: ${shown}`] : [])].join("; ");
}

const signed = (v: bigint) => `${v < 0n ? "-" : "+"}${formatStroops(v < 0n ? -v : v).replace(/\.?0+$/, "")}`;
const isEvent = (r: LogRecord): r is IssuerEvent => r.kind === "event";
const isRun = (r: LogRecord): r is RunRecord => r.kind === "run";

type Group = { issuer: string; codes: string[]; keys: string[] };

function groupByIssuer(pinned: readonly PinnedAsset[]): Group[] {
  const map = new Map<string, Group>();
  for (const a of pinned) {
    const g = map.get(a.issuer) ?? { issuer: a.issuer, codes: [], keys: [] };
    g.codes.push(a.code);
    g.keys.push(assetKeyOf(a));
    map.set(a.issuer, g);
  }
  return [...map.values()];
}

/** Classify the ops of one issuer's read into per-asset ops, unclassified ops, and issuer events. */
async function classifyRead(read: OpsRead, group: Group, horizon: HorizonSource, seenAt: string) {
  const ops = new Map<string, AssetOp[]>();
  const unclassified = new Map<string, UnclassifiedOp[]>();
  const events: IssuerEvent[] = [];
  const push = <T>(m: Map<string, T[]>, k: string, v: T) => m.set(k, [...(m.get(k) ?? []), v]);
  for (const op of read.ops) {
    let effects: HorizonEffect[] | undefined;
    if (needsEffects(op, group.issuer)) effects = (await horizon.readOpEffects(op.id)) ?? undefined;
    const r = classifyOp(op, group.issuer, group.codes, effects);
    const base = { ledger: opLedger(op), at: op.created_at, tx: op.transaction_hash };
    for (const s of r.supply) push(ops, s.asset, { ...base, side: s.side, amount: s.amount });
    for (const k of r.unclassified) push(unclassified, k, base);
    if (r.issuerChange) events.push(issuerChangeEvent(op, group.issuer, group.keys, r.issuerChange, seenAt));
  }
  return { ops, unclassified, events };
}

/** Daily classified sums per asset, for the replay (not reconciled with supply). */
function dailySums(ops: readonly AssetOp[]) {
  const days = new Map<string, { minted: bigint; burned: bigint; n: number }>();
  for (const o of ops) {
    const d = days.get(dayOf(o.at)) ?? { minted: 0n, burned: 0n, n: 0 };
    if (o.side === "mint") d.minted += o.amount; else d.burned += o.amount;
    d.n++;
    days.set(dayOf(o.at), d);
  }
  return [...days.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
}

/** `--replay-from` and `--lookback-hours`: read history, print, write nothing. */
async function replay(opts: RunOptions, deps: RunDeps): Promise<RunResult> {
  const { flags, limits, now } = opts;
  const out = deps.log;
  const universe = loadUniverse(path.join(opts.dataDir, "assets.csv")).filter((a) => a.issuer && a.asset_code);
  const pinned = universe.map((a): PinnedAsset => ({ code: a.asset_code, issuer: a.issuer }));
  const groups = groupByIssuer(pinned);
  const fail = (msg: string): RunResult => { out(msg); return { exitCode: 1, plan: null, events: [], run: null }; };

  let since: string;
  if (flags.replayFrom !== undefined) {
    if (!isIsoDay(flags.replayFrom)) return fail("--replay-from must be a real date in the form YYYY-MM-DD");
    since = `${flags.replayFrom}T00:00:00Z`;
  } else {
    const h = flags.lookbackHours!;
    if (!Number.isInteger(h) || h < 1 || h > 48) return fail("--lookback-hours must be a whole number from 1 to 48");
    since = new Date(now.getTime() - h * 3_600_000).toISOString();
  }
  const wanted = flags.replayIssuers ?? [];
  for (const g of wanted) if (!groups.some((x) => x.issuer === g)) return fail(`${g} is not a pinned issuer in data/assets.csv`);
  const chosen = wanted.length > 0 ? groups.filter((g) => wanted.includes(g.issuer)) : groups;

  out(`Replay from ${since} (read only: nothing is written, nothing is run).`);
  const events: IssuerEvent[] = [];
  let partial = false;
  for (const g of chosen) {
    if (deps.horizon.remaining() <= 0) { partial = true; out(`budget used up before ${g.issuer}`); continue; }
    const read = await deps.horizon.readIssuerOps(g.issuer, { mode: "backfill", since, maxPages: limits.maxPagesPerIssuer });
    if (read.partial) { partial = true; out(`partial read for ${g.issuer}${read.error ? `: ${read.error}` : ""}`); }
    const c = await classifyRead(read, g, deps.horizon, now.toISOString());
    events.push(...c.events);
    for (const key of g.keys) {
      const sums = dailySums(c.ops.get(key) ?? []);
      if (sums.length === 0) continue;
      out(`${key}: classified daily mint and burn sums (not reconciled with supply)`);
      for (const [d, v] of sums) out(`  ${d}  minted ${formatStroops(v.minted)}  burned ${formatStroops(v.burned)}  ops ${v.n}`);
    }
  }
  events.sort((a, b) => Date.parse(a.ledger_closed_at) - Date.parse(b.ledger_closed_at) || (a.id < b.id ? -1 : 1));
  if (events.length === 0) out("No issuer event found in the window.");
  for (const e of events) {
    out(`EVENT ${e.type}: ${describeEvent(e)}`);
    if (e.tx_hash) out(`  ${EXPLORER_TX}/${e.tx_hash}`);
  }
  const codes = [...new Set(events.flatMap((e) => e.assets))].map((k) => k.split(":")[0]);
  if (codes.length > 0) out(`would re-check ${codes.join(", ")} (triggered assets; a re-check covers every pinned asset)`);
  out(`Horizon requests: ${deps.horizon.requests}`);
  const exitCode = flags.lookbackHours !== undefined && events.length > 0 ? 5 : 0;
  return { exitCode, plan: null, events, run: null };
}

export async function runMonitor(opts: RunOptions, deps: RunDeps): Promise<RunResult> {
  const { now, dataDir, flags, limits } = opts;
  const out = deps.log;
  if (flags.replayFrom !== undefined || flags.lookbackHours !== undefined) return replay(opts, deps);

  const mdir = path.join(dataDir, "monitor");
  const writes = !flags.dryRun;
  let release = () => {};
  if (writes) {
    try {
      release = acquireLock(mdir, now);
    } catch (err) {
      if (err instanceof LockError) { out(err.message); return { exitCode: 1, plan: null, events: [], run: null }; }
      throw err;
    }
  }
  try {
    return await watch(opts, deps, mdir, writes);
  } catch (err) {
    out(`refused: ${err instanceof Error ? err.message : String(err)}`);
    return { exitCode: 1, plan: null, events: [], run: null };
  } finally {
    release();
  }
}

async function watch(opts: RunOptions, deps: RunDeps, mdir: string, writes: boolean): Promise<RunResult> {
  const { now, dataDir, flags, limits } = opts;
  const { horizon } = deps;
  const out = deps.log;
  const today = now.toISOString().slice(0, 10);
  const nowIso = now.toISOString();
  const todayStart = Date.parse(`${today}T00:00:00Z`);

  // 1. Load everything the run reads. Any inconsistency is a refusal (exit 1), never a guess.
  const universe = loadUniverse(path.join(dataDir, "assets.csv")).filter((a) => a.issuer && a.asset_code);
  if (universe.length === 0) throw new Error("data/assets.csv is missing or empty");
  const pinned = universe.map((a): PinnedAsset => ({ code: a.asset_code, issuer: a.issuer }));
  const keys = pinned.map(assetKeyOf);
  const groups = groupByIssuer(pinned);
  const state: MonitorState = loadState(mdir);
  const log = readLog(mdir);
  const frozen = loadFrozen(dataDir);
  const checks = readChecks(dataDir);
  const newestChecks = checks[checks.length - 1] ?? null;
  const chainTimes = new Map<string, string | null>();
  for (const a of universe) {
    const row = newestChecks?.results.find((r) => r.asset_code === a.asset_code && r.issuer === a.issuer);
    chainTimes.set(assetKeyOf({ code: a.asset_code, issuer: a.issuer }), row ? chainCheckedAt({ ...row, file: newestChecks!.file }) : null);
  }
  const statusRel = newestStatusRel(dataDir);
  const newestStatus = statusRel ? readStatus(dataDir, statusRel) : null;
  const raisedByAsset = new Map((newestStatus?.assets ?? []).map((a) => [a.asset, a.raised.map((r) => r.flag)]));

  // 2. Supply points first (root, asset, root brackets).
  const reads = await horizon.readSupplyPoints(pinned);
  const partial = new Set<string>();
  if (reads.budgetEnded) out("Horizon request budget ended while reading supply points.");

  // 3 to 5. Ops, classification, reconciliation, events. Oldest coverage first.
  const ordered = [...groups].sort((a, b) => Date.parse(state.issuers[a.issuer]?.covered_through_at ?? "1970-01-01T00:00:00Z") - Date.parse(state.issuers[b.issuer]?.covered_through_at ?? "1970-01-01T00:00:00Z"));
  const known = new Set(log.filter(isEvent).map((e) => e.id));
  const newEvents: IssuerEvent[] = [];
  const addEvent = (e: IssuerEvent) => { if (!known.has(e.id)) { known.add(e.id); newEvents.push(deps.synthetic ? { ...e, synthetic: true } : e); } };
  const readingsByAsset = new Map<string, { supply: string; at: string }[]>();
  for (const f of checks) for (const r of f.results) {
    const k = `${r.asset_code}:${r.issuer}`;
    if (r.facts?.supply && r.facts.checkedAt) readingsByAsset.set(k, [...(readingsByAsset.get(k) ?? []), { supply: r.facts.supply, at: r.facts.checkedAt }]);
  }
  const since = `${addDays(today, -9)}T00:00:00Z`;

  for (const g of ordered) {
    const prev: IssuerState = state.issuers[g.issuer] ?? { cursor: null, covered_from: null, covered_through_ledger: null, covered_through_at: null };
    let read: OpsRead | null = null;
    if (horizon.remaining() <= 0) {
      partial.add(g.issuer);
    } else {
      const backfill = prev.cursor === null;
      read = await horizon.readIssuerOps(g.issuer, backfill ? { mode: "backfill", since, maxPages: limits.maxPagesPerIssuer } : { mode: "forward", cursor: prev.cursor!, maxPages: limits.maxPagesPerIssuer });
      if (read.partial) partial.add(g.issuer);
      if (read.error) out(`Horizon read for ${g.issuer} stopped: ${read.error}`);
    }
    const c = read ? await classifyRead(read, g, horizon, nowIso) : { ops: new Map<string, AssetOp[]>(), unclassified: new Map<string, UnclassifiedOp[]>(), events: [] as IssuerEvent[] };
    c.events.forEach(addEvent);

    const next: IssuerState = {
      cursor: read?.newestCursor ?? prev.cursor,
      covered_from: prev.covered_from,
      covered_through_ledger: read?.coveredThroughLedger ?? prev.covered_through_ledger,
      covered_through_at: read?.coveredThroughAt ?? prev.covered_through_at,
    };
    if (read && prev.cursor === null && read.coveredFrom !== null) {
      const contiguous = prev.covered_from !== null && prev.covered_through_at !== null && Date.parse(prev.covered_through_at) >= Date.parse(read.coveredFrom);
      next.covered_from = contiguous ? prev.covered_from : read.coveredFrom;
    }
    state.issuers[g.issuer] = next;
    const cov = { from: next.covered_from, through_ledger: next.covered_through_ledger, through_at: next.covered_through_at };

    for (const key of g.keys) {
      const st: AssetState = state.assets[key] ?? emptyAssetState(today);
      const assetOps = c.ops.get(key) ?? [];
      const unclassified = c.unclassified.get(key) ?? [];
      const candidates = [...(reads.points.has(key) ? [reads.points.get(key)!] : [])];
      if (read && prev.cursor === null) {
        // A backfill: supply readings stored in earlier checks files can anchor the intervals.
        const times = [...assetOps, ...unclassified].map((o) => o.at);
        candidates.push(...anchoredPoints(readingsByAsset.get(key) ?? [], times));
      }
      const { state: advanced, unreconciled } = advance(st, usablePoints(candidates, cov), assetOps, unclassified);
      for (const u of unreconciled) {
        addEvent({
          kind: "event", id: unreconciledEventId(key, u.from.ledger ?? u.from.at, u.to.ledger ?? u.to.at), seen_at: nowIso, type: "supply_unreconciled", issuer: g.issuer, assets: [key],
          ledger: u.to.ledger, ledger_closed_at: u.to.at,
          changes: [`observed supply change ${signed(u.observed)}`, `classified net ${signed(u.classified)}`],
        });
      }
      // Intraday large mint or burn (spec 4.6).
      advanced.intraday = updateIntraday(advanced.intraday, today, assetOps);
      const newest = advanced.points[advanced.points.length - 1];
      const opening = [...advanced.points].reverse().find((p) => Date.parse(p.at) < todayStart);
      const supplies = [newest, opening].filter((p): p is NonNullable<typeof p> => !!p).map((p) => toStroops(p.supply));
      const base = supplies.length > 0 ? supplies.reduce((a, b) => (a > b ? a : b)) : null;
      const latestToday = (side: "mint" | "burn") => [...assetOps].reverse().find((o) => o.side === side && dayOf(o.at) === today) ?? null;
      const large = intradayLarge({
        asset: key, issuer: g.issuer, today, intraday: advanced.intraday, seen: advanced.large_seen, base,
        latest: { mint: latestToday("mint"), burn: latestToday("burn") }, seenAt: nowIso,
      });
      large.events.forEach(addEvent);
      advanced.large_seen = large.seen.filter((k) => k.startsWith(`${today}:`));
      state.assets[key] = advanced;
    }
  }
  newEvents.sort((a, b) => Date.parse(a.ledger_closed_at) - Date.parse(b.ledger_closed_at) || (a.id < b.id ? -1 : 1));

  // 6. Pending triggers and the plan.
  const asPending = (e: IssuerEvent): PendingEvent => ({ event_id: e.id, assets: e.assets, ledger_closed_at: e.ledger_closed_at });
  const merged = [...state.pending, ...newEvents.map(asPending)].filter((p, i, all) => all.findIndex((q) => q.event_id === p.event_id) === i);
  const uncovered = uncoveredPending(merged, (k) => chainTimes.get(k) ?? null);
  state.pending = uncovered;
  const allEvents = [...log.filter(isEvent), ...newEvents];
  const cadence: CadenceAsset[] = keys.map((k, i) => ({
    asset: k, code: universe[i].asset_code, chainCheckedAt: chainTimes.get(k) ?? null,
    tier: tier({ asset: k, events: allEvents, raisedFlags: raisedByAsset.get(k) ?? [], now }),
  }));
  const reRuns = log.filter(isRun).filter((r) => (r.outcome === "ran" || r.outcome === "failed") && r.day === today);
  const plan = planRun({
    now, assets: cadence, pending: uncovered, runsToday: reRuns.length,
    lastRunAt: reRuns.length ? reRuns.map((r) => r.at).sort().at(-1)! : null,
    frozenToday: targetFiles(today).some((p) => frozen.has(p)), flags, limits,
  });

  // Report.
  const window = issuanceWindow(today);
  out(`Monitor ${nowIso}: ${newEvents.length} new event(s), Horizon requests ${horizon.requests}/${limits.maxRequests}${partial.size ? `, partial issuers ${partial.size}` : ""}.`);
  for (const e of newEvents) out(`EVENT ${e.type}: ${describeEvent(e)}`);
  for (const key of keys) {
    const st = state.assets[key];
    if (!st) { out(`${key.split(":")[0].padEnd(9)} no data this run${reads.failures.has(key) ? ` (${reads.failures.get(key)})` : ""}`); continue; }
    const c = completeDays(st, window);
    const un = st.intervals.filter((i) => !i.explained).length;
    out(`${key.split(":")[0].padEnd(9)} points ${st.points.length}, intervals ${st.intervals.length} (${un} not explained), unclassified ${st.intervals.reduce((n, i) => n + i.unclassified, 0)}, complete days ${c.days.length}/${window.length}`);
  }
  const codesOf = (list: readonly string[]) => universe.filter((_, i) => list.includes(keys[i])).map((a) => a.asset_code);
  const triggered = flags.forced ? universe.map((a) => a.asset_code) : [...new Set([
    ...codesOf(uncovered.flatMap((p) => p.assets)),
    ...plan.reasons.filter((r) => r.startsWith("schedule:")).map((r) => r.slice("schedule:".length)),
  ])];
  if (plan.reasons.length === 0) out("No re-check due.");
  else if (flags.dryRun) out(`would re-check ${triggered.join(", ")} (triggered assets; a re-check covers every pinned asset). Reasons: ${summarizeReasons(plan.reasons)}`);
  else if (plan.run) out(`Re-check due now. Reasons: ${summarizeReasons(plan.reasons)}`);
  else out(`Re-check deferred (${plan.deferred?.reason}${plan.deferred?.until ? `, until ${plan.deferred.until}` : ""}). Reasons: ${summarizeReasons(plan.reasons)}`);
  const newestLogStatus = readLogStatusFiles(dataDir).at(-1) ?? null;
  const publishedStatus = newestLogStatus ? readStatus(dataDir, newestLogStatus) : null;
  const publishedAt = publishedStatus ? publishedStatus.assets.map((a) => a.checked_at).filter((t): t is string => !!t).sort().at(-1) ?? null : null;
  if (publishedAt) {
    const age = (now.getTime() - Date.parse(publishedAt)) / 86_400_000;
    out(`Newest published chain check: ${publishedAt} (${age.toFixed(1)} days ago).${age > STALE_DAYS ? ` Notice: older than ${STALE_DAYS} days.` : ""}`);
  }

  if (!writes) {
    out("Dry run: nothing was written and nothing was run.");
    return { exitCode: partial.size > 0 || reads.budgetEnded ? 2 : 0, plan, events: newEvents, run: null };
  }

  // 7. Write: events and state first, then the re-check if the plan says so.
  appendLog(mdir, newEvents);
  saveState(mdir, state);
  let outcome: RunRecord["outcome"] = plan.run ? "ran" : plan.deferred && plan.deferred.reason !== "no_recheck" ? "deferred" : "watch_only";
  let steps: RunRecord["steps"];
  let files: RunRecord["files"];
  let diff: RunRecord["diff"];
  let exitCode: RunResult["exitCode"] = partial.size > 0 || reads.budgetEnded ? 2 : 0;

  if (plan.run) {
    const issuanceRel = issuancePath(today);
    assertWritable(issuanceRel, dataDir);
    const replaced = targetFiles(today).filter((rel) => fs.existsSync(path.join(path.dirname(dataDir), rel)));
    if (replaced.length > 0) out(`Day files of ${today} that this re-check replaces (none was published): ${replaced.join(", ")}`);
    writeFileAtomic(path.join(path.dirname(dataDir), issuanceRel), stableJson(buildIssuance(today, nowIso, state, keys)));
    const result = runPipeline(today, { exec: deps.exec, frontendDir: deps.frontendDir, show: (t) => t.split("\n").filter(Boolean).forEach(out) });
    steps = result.steps;
    files = targetFiles(today).flatMap((rel) => {
      const f = path.join(path.dirname(dataDir), rel);
      return fs.existsSync(f) ? [{ path: rel, sha256: sha256Hex(fs.readFileSync(f, "utf8")) }] : [];
    });
    if (result.ok) {
      state.pending = state.pending.filter((p) => !plan.reasons.includes(`event:${p.event_id}`));
      const fresh = readStatus(dataDir, `data/status/${today}.json`);
      if (fresh) {
        diff = diffStatus(publishedStatus, fresh, newestLogStatus);
        for (const line of describeDiff(diff)) out(`diff: ${line}`);
      }
      saveState(mdir, state);
    } else {
      outcome = "failed";
      exitCode = 3;
      out(`Re-check failed at step ${result.steps[result.steps.length - 1].step}.`);
    }
    out(`Files for ${today}: ${(files ?? []).map((f) => f.path).join(", ") || "none"}`);
  }

  const record: RunRecord = {
    kind: "run", at: nowIso, day: today, reasons: plan.reasons, outcome,
    ...(plan.deferred ? { deferred: plan.deferred } : {}),
    ...(steps ? { steps } : {}), ...(files ? { files } : {}), ...(diff ? { diff } : {}),
    horizon_requests: horizon.requests, partial_issuers: [...partial],
    ...(deps.synthetic ? { synthetic: true as const } : {}),
  };
  appendLog(mdir, [record]);
  return { exitCode, plan, events: newEvents, run: record };
}

/** The status files named by data/feed/log.json (the published ones). */
function readLogStatusFiles(dataDir: string): string[] {
  const file = path.join(dataDir, "feed", "log.json");
  if (!fs.existsSync(file)) return [];
  const log = JSON.parse(fs.readFileSync(file, "utf8")) as { status_file?: unknown }[];
  return log.map((r) => r.status_file).filter((s): s is string => typeof s === "string");
}

