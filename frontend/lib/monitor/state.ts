/**
 * State, log, and lock files of the Monitor (D-047, spec 3.2). Everything is written atomically
 * (temp file in the same folder, then rename). `state.json` is never a status input: losing it
 * costs a backfill, not correctness. `log.json` is a JSON array that is only ever appended to.
 */
import fs from "fs";
import path from "path";
import { z } from "zod";
import { stateSchema, type LogRecord, type MonitorState } from "./types";

export const STATE_FILE = "state.json";
export const LOG_FILE = "log.json";
export const LOCK_FILE = ".lock";
/** A lock older than this is taken over (a run that died). */
export const LOCK_STALE_MS = 2 * 3_600_000;

export const emptyState = (): MonitorState => ({ version: 1, issuers: {}, assets: {}, pending: [] });

export function writeFileAtomic(file: string, text: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

/** Load `state.json`; a missing file is an empty state. An unknown version or a bad shape is refused (never guessed). */
export function loadState(dir: string): MonitorState {
  const file = path.join(dir, STATE_FILE);
  if (!fs.existsSync(file)) return emptyState();
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as { version?: unknown };
  if (raw.version !== 1) throw new Error(`${STATE_FILE}: unknown version ${String(raw.version)}; refusing to read it`);
  const parsed = stateSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`${STATE_FILE} is invalid: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return parsed.data;
}

export function saveState(dir: string, state: MonitorState) {
  stateSchema.parse(state); // never write a file the loader would refuse
  writeFileAtomic(path.join(dir, STATE_FILE), JSON.stringify(state, null, 2) + "\n");
}

const logSchema = z.array(z.object({ kind: z.enum(["event", "run"]) }).loose());

export function readLog(dir: string): LogRecord[] {
  const file = path.join(dir, LOG_FILE);
  if (!fs.existsSync(file)) return [];
  return logSchema.parse(JSON.parse(fs.readFileSync(file, "utf8"))) as unknown as LogRecord[];
}

/** Append records; the earlier records are rewritten exactly as read. Atomic: a crash leaves the old file. */
export function appendLog(dir: string, records: readonly LogRecord[]) {
  if (records.length === 0) return;
  writeFileAtomic(path.join(dir, LOG_FILE), JSON.stringify([...readLog(dir), ...records], null, 2) + "\n");
}

export class LockError extends Error {}

/** Take the run lock (`wx`: fails when it exists). A lock older than 2 h is taken over. Returns the release function. */
export function acquireLock(dir: string, now = new Date()): () => void {
  const file = path.join(dir, LOCK_FILE);
  fs.mkdirSync(dir, { recursive: true });
  const take = () => {
    const fd = fs.openSync(file, "wx");
    fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: now.toISOString() }));
    fs.closeSync(fd);
  };
  try {
    take();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    const age = now.getTime() - fs.statSync(file).mtimeMs;
    if (age <= LOCK_STALE_MS) throw new LockError("already running (data/monitor/.lock exists)");
    fs.rmSync(file, { force: true });
    take();
  }
  return () => fs.rmSync(file, { force: true });
}
