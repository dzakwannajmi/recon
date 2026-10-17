/**
 * Write-once evidence (D-047, spec 4.8; closes threat Tamper.8). A day file that a published status
 * used is frozen: every writer calls `assertWritable` before it writes. "Published" = named in
 * data/feed/log.json, confirmed or not, so a send with an unknown outcome also freezes its inputs.
 * The check reads the log fresh each time; nothing is cached.
 */
import fs from "fs";
import path from "path";
import { z } from "zod";

const logSchema = z.array(z.object({ status_file: z.string() }).loose());

export const DEFAULT_DATA_DIR = path.join(process.cwd(), "..", "data");

const objPath = (v: unknown): string | null =>
  v && typeof v === "object" && typeof (v as { path?: unknown }).path === "string" ? (v as { path: string }).path : null;

/**
 * Every repo-relative path a published status used, mapped to the first status file that used it.
 * A log record whose status file cannot be read is an error: the freeze would be incomplete.
 */
export function frozenPaths(log: readonly { status_file: string }[], readStatus: (rel: string) => unknown | null): Map<string, string> {
  const frozen = new Map<string, string>();
  for (const rec of log) {
    const status = readStatus(rec.status_file);
    if (status === null || typeof status !== "object") throw new Error(`data/feed/log.json names ${rec.status_file}, but the file is missing or unreadable`);
    const inputs = ((status as { inputs?: unknown }).inputs ?? {}) as Record<string, unknown>;
    const paths = [rec.status_file, objPath(inputs.checks), objPath(inputs.previous_checks), objPath(inputs.examinations), objPath(inputs.issuance)];
    if (Array.isArray(inputs.checks_history)) for (const h of inputs.checks_history) paths.push(objPath(h));
    for (const p of paths) if (p && !frozen.has(p)) frozen.set(p, rec.status_file);
  }
  return frozen;
}

/** Load the frozen set from a data folder (the log and the status files it names). */
export function loadFrozen(dataDir = DEFAULT_DATA_DIR): Map<string, string> {
  const repo = path.dirname(dataDir);
  const logFile = path.join(dataDir, "feed", "log.json");
  if (!fs.existsSync(logFile)) return new Map();
  const log = logSchema.parse(JSON.parse(fs.readFileSync(logFile, "utf8")));
  return frozenPaths(log, (rel) => {
    const file = path.join(repo, rel);
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
  });
}

/** Throws unless the repo-relative path (e.g. `data/checks/2026-10-15.json`) may be written. */
export function assertWritable(rel: string, dataDir = DEFAULT_DATA_DIR): void {
  const by = loadFrozen(dataDir).get(rel);
  if (by) throw new Error(`refusing to overwrite ${rel}: published status ${by} used it (data/feed/log.json)`);
}

/** The four day files a re-check for `day` writes (the status file included). */
export const targetFiles = (day: string): string[] => [
  `data/checks/${day}.json`, `data/examinations/${day}.json`, `data/status/${day}.json`, `data/monitor/issuance/${day}.json`,
];
