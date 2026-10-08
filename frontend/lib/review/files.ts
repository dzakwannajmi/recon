/**
 * Review folder I/O shared by `review:queue` and `import:review`:
 *
 *   data/review/queue.json          open work and statuses (written by review:queue / import:review)
 *   data/review/proposals/<id>.json written by the operator, committed
 *   data/review/imports.json        what the importer did with each proposals file
 */
import fs from "node:fs";
import path from "node:path";
import type { createContextFactory } from "../claims/context";
import { docKey, type ClaimStore, type ExtractionRun } from "../claims/store";
import { sha256Hex, type SnapshotRecord, type SnapshotStore } from "../documents/store";
import { buildQueue, queueReason, reviewId, type ImportLogEntry, type ProposalState, type QueueEntry } from "./queue";
import { MAX_PROPOSALS_BYTES, validateProposals, type ProposalsResult } from "./proposals";

export const DEFAULT_REVIEW_DIR = path.join(process.cwd(), "..", "data", "review");

export type ReviewEnv = {
  reviewDir: string;
  store: ClaimStore;
  snapshots: SnapshotStore;
  factory: ReturnType<typeof createContextFactory>;
  now: string;
};

export type LoadedProposal = {
  /** The review id, or `invalid-<hash of the name>` for a name that is not <16 hex>.json (a raw name is never logged). */
  id: string;
  file_sha256: string;
  /** The run and the usable snapshot record the file name points to (null if none). */
  run: ExtractionRun | null;
  record: SnapshotRecord | null;
  result: ProposalsResult;
};

export function readJson<T>(file: string, fallback: T): T {
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as T) : fallback;
}

export function writeJson(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

/** A name that may be echoed: only a bare 16-hex review id plus .json. Anything else is shown as a hash. */
export const safeName = (name: string) => (/^[0-9a-f]{16}\.json$/.test(name) ? name : `invalid-${sha256Hex(name).slice(0, 16)}`);

/**
 * Read and validate every proposals file, in sorted order. Only regular files
 * are read (never through a symlink); other names in the folder are skipped
 * with a warning that carries the hashed name, not the name.
 */
export function loadProposals(env: ReviewEnv): { loaded: LoadedProposal[]; warnings: string[] } {
  const dir = path.join(env.reviewDir, "proposals");
  const names = fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
  const queued = new Set(readQueue(env).map((e) => e.id));
  const warnings: string[] = [];
  const loaded: LoadedProposal[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) {
      warnings.push(`skipped ${safeName(name)} in proposals/ (only <id>.json files are read)`);
      continue;
    }
    const stem = name.slice(0, -".json".length);
    const valid = /^[0-9a-f]{16}$/.test(stem);
    const id = valid ? stem : safeName(name);
    const run = valid ? env.store.runs.find((r) => reviewId(r.doc_key) === stem) ?? null : null;
    const found = run ? env.snapshots.all().find((r) => docKey(r.sha256, r.assets) === run.doc_key) : undefined;
    const record = found?.text ? found : null;
    const refuse = (reason: string): LoadedProposal => ({ id, file_sha256: sha256Hex(`unread:${reason}`), run, record, result: { ok: false, reason, text_sha256: null } });
    const file = path.join(dir, name);
    const st = fs.lstatSync(file);
    if (st.isSymbolicLink()) loaded.push(refuse("symlinks are not allowed"));
    else if (!st.isFile()) loaded.push(refuse("not a regular file"));
    else if (!valid) loaded.push(refuse("file name must be <id>.json with a 16-hex id"));
    else if (st.size > MAX_PROPOSALS_BYTES) loaded.push(refuse(`file is larger than ${MAX_PROPOSALS_BYTES / 1024} KB`));
    else {
      let bytes: Buffer;
      try {
        // O_NOFOLLOW: a file swapped for a symlink after the check is still not followed.
        const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        try {
          bytes = fs.readFileSync(fd);
        } finally {
          fs.closeSync(fd);
        }
      } catch {
        loaded.push(refuse("could not be read as a regular file"));
        continue;
      }
      // A file must point at a queue entry: a qualifying run, or an entry already in queue.json.
      const inQueue = run !== null && (queueReason(run) !== null || queued.has(stem));
      const expected = run && record && inQueue ? { doc_key: run.doc_key, codes: env.factory.assetRefsOf(record).map((a) => a.code), sourceClass: record.sourceClass } : null;
      loaded.push({
        id, file_sha256: sha256Hex(bytes), run, record,
        result: validateProposals({ stem, raw: bytes.toString("utf8"), bytes: bytes.length, expected, now: env.now }),
      });
    }
  }
  return { loaded, warnings };
}

export function readImports(env: ReviewEnv) {
  return readJson<ImportLogEntry[]>(path.join(env.reviewDir, "imports.json"), []);
}

export function readQueue(env: ReviewEnv) {
  return readJson<QueueEntry[]>(path.join(env.reviewDir, "queue.json"), []);
}

/** The queue for the current claims, snapshots, proposals files, and import log. */
export function currentQueue(env: ReviewEnv, loaded: LoadedProposal[], imports: ImportLogEntry[]) {
  const proposals: Record<string, ProposalState> = {};
  for (const l of loaded) {
    if (!l.run || !l.record) continue;
    proposals[l.id] = { file_sha256: l.file_sha256, text_sha256: l.result.ok ? l.result.file.text_sha256 : l.result.text_sha256, refused: l.result.ok ? null : l.result.reason };
  }
  return buildQueue({
    runs: env.store.runs, records: env.snapshots.all(), names: env.factory.names, dropped: env.store.dropped, proposals, imports,
    previous: readQueue(env), textValid: (r) => env.factory.contextFor(r) !== null, now: env.now,
  });
}

export function writeQueue(env: ReviewEnv, entries: QueueEntry[]) {
  writeJson(path.join(env.reviewDir, "queue.json"), entries);
}

export function printQueue(entries: QueueEntry[], skipped: string[], warnings: string[] = []) {
  for (const w of warnings) console.log(`warning: ${w}`);
  for (const e of entries) console.log(`${e.id}  ${e.status.padEnd(8)} ${e.reason.padEnd(18)} ${e.assets.map((a) => a.code).join(",")}  ${e.chars} chars  ${e.source_url}`);
  for (const s of skipped) console.log(`skip ${s}`);
}
