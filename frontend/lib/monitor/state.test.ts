import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireLock, appendLog, emptyState, LOCK_STALE_MS, LockError, loadState, readLog, saveState } from "./state";
import type { MonitorState, RunRecord } from "./types";

let dir = "";
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "mon-state-")); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const sample = (): MonitorState => ({
  version: 1,
  issuers: { G1: { cursor: "123", covered_from: "2026-10-08T00:00:00Z", covered_through_ledger: 10, covered_through_at: "2026-10-17T10:00:00Z" } },
  assets: {
    "A:G1": {
      points: [{ ledger: 10, at: "2026-10-17T10:00:00Z", supply: "5.0000000", source: "monitor" }],
      intervals: [],
      open: { from_point: { ledger: 10, at: "2026-10-17T10:00:00Z", supply: "5.0000000", source: "monitor" }, by_day: { "2026-10-17": { minted: "1.0000000", burned: "0.0000000", ops: 1, top_tx: [{ tx: "t", side: "mint", amount: "1.0000000" }] } }, unclassified: 0 },
      intraday: { date: "2026-10-17", minted: "1.0000000", burned: "0.0000000" },
      large_seen: [],
    },
  },
  pending: [{ event_id: "abc", assets: ["A:G1"], ledger_closed_at: "2026-10-17T09:00:00Z" }],
});
const run = (at: string): RunRecord => ({ kind: "run", at, day: at.slice(0, 10), reasons: [], outcome: "watch_only", horizon_requests: 1, partial_issuers: [] });

describe("S1: state", () => {
  it("a missing file is an empty state; save then load gives the same state, with no temp file left", () => {
    expect(loadState(dir)).toEqual(emptyState());
    saveState(dir, sample());
    expect(loadState(dir)).toEqual(sample());
    expect(fs.readdirSync(dir)).toEqual(["state.json"]);
  });

  it("refuses an unknown version, a bad shape, and writing a state the loader would refuse", () => {
    fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify({ ...sample(), version: 2 }));
    expect(() => loadState(dir)).toThrow(/unknown version 2/);
    fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify({ ...sample(), extra: 1 }));
    expect(() => loadState(dir)).toThrow(/state\.json is invalid/);
    const bad = sample();
    bad.assets["A:G1"].points[0].supply = "5";
    expect(() => saveState(dir, bad)).toThrow();
  });
});

describe("S1: log", () => {
  it("appends without changing earlier records, atomically", () => {
    expect(readLog(dir)).toEqual([]);
    appendLog(dir, [run("2026-10-17T10:00:00Z")]);
    const first = fs.readFileSync(path.join(dir, "log.json"), "utf8");
    appendLog(dir, [run("2026-10-17T16:00:00Z"), run("2026-10-17T17:00:00Z")]);
    const second = fs.readFileSync(path.join(dir, "log.json"), "utf8");
    expect(JSON.parse(second).slice(0, 1)).toEqual(JSON.parse(first));
    expect(readLog(dir)).toHaveLength(3);
    expect(fs.readdirSync(dir)).toEqual(["log.json"]);
    appendLog(dir, []);
    expect(fs.readFileSync(path.join(dir, "log.json"), "utf8")).toBe(second);
  });

  it("refuses a log that is not an array of records (never overwrites it)", () => {
    fs.writeFileSync(path.join(dir, "log.json"), '{"oops":1}');
    expect(() => appendLog(dir, [run("2026-10-17T10:00:00Z")])).toThrow();
    expect(fs.readFileSync(path.join(dir, "log.json"), "utf8")).toBe('{"oops":1}');
  });
});

describe("S1: lock", () => {
  it("a second run is refused; after release it can start again", () => {
    const release = acquireLock(dir);
    expect(() => acquireLock(dir)).toThrow(LockError);
    expect(() => acquireLock(dir)).toThrow(/already running/);
    release();
    acquireLock(dir)();
    expect(fs.existsSync(path.join(dir, ".lock"))).toBe(false);
  });

  it("a lock older than 2 h is taken over; a younger one is not", () => {
    acquireLock(dir);
    const file = path.join(dir, ".lock");
    const now = new Date();
    const old = new Date(now.getTime() - LOCK_STALE_MS - 60_000);
    fs.utimesSync(file, old, old);
    const release = acquireLock(dir, now);
    expect(fs.existsSync(file)).toBe(true);
    release();
    acquireLock(dir);
    const young = new Date(now.getTime() - LOCK_STALE_MS + 60_000);
    fs.utimesSync(file, young, young);
    expect(() => acquireLock(dir, now)).toThrow(LockError);
  });
});
