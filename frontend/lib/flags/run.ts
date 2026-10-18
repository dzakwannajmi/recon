/**
 * One status run over the stored files (D-035, D-038, D-047). Deterministic: reads the data folder
 * only, no network, no LLM, no env file. The script `scripts/status.ts` is a thin wrapper that
 * writes the result; tests call this with a temporary data folder.
 *
 * Reads (repo-relative to data/):
 *   checks/YYYY-MM-DD.json            every file dated <= as-of, oldest first; the newest is the current one (D-038 hold window)
 *   examinations/YYYY-MM-DD.json      newest dated <= as-of
 *   monitor/issuance/YYYY-MM-DD.json  newest dated <= as-of (D-047; absent = LARGE_MINT_BURN not evaluated)
 *   claims/claims.json, claims/sources.json, snapshots/index.json
 *   review/flags.json                 optional operator confirmations
 */
import fs from "fs";
import path from "path";
import { loadUniverse } from "../chain/universe";
import type { Claim } from "../claims/store";
import { sha256Hex, type SnapshotRecord } from "../documents/store";
import type { CheckResult } from "../examine/checks";
import type { StoredSourceFact } from "../examine/sources";
import { parseIssuance } from "../monitor/issuance";
import { evaluateAsset, seriesFor } from "./evaluate";
import { assetContext } from "./feed";
import { datedFiles, datedFilesOldestFirst } from "./inputs";
import { assetStatus, parseReviews, type AssetStatus, type Review } from "./status";
import { FEED_SCHEMA, FLAG_BITS, RULES_VERSION, STATUS_CODES, type ChecksRow } from "./types";

type Input = { path: string; sha256: string };

export type StatusOutput = {
  generated_at: string;
  as_of: string;
  feed_schema: number;
  rules_version: string;
  inputs: Record<string, unknown>;
  bits: typeof FLAG_BITS;
  status_codes: typeof STATUS_CODES;
  summary: { OK: number; WARNING: number; CRITICAL: number; unpublished: number; pending_review: number };
  assets: AssetStatus[];
};

const toRows = (file: string, results: Omit<ChecksRow, "file">[]): ChecksRow[] => results.map((r) => ({ ...r, file: `data/${file}` }));

export function buildStatus(opts: { dataDir: string; asOf: string; now: Date; assetsCsv?: string }): StatusOutput {
  const { dataDir, asOf } = opts;
  const universe = loadUniverse(opts.assetsCsv);
  if (universe.length === 0) throw new Error("data/assets.csv is missing or empty");

  /** The dated files of a folder up to as-of, as `folder/YYYY-MM-DD.json`. */
  const datedIn = (folder: string, order: "newest" | "oldest" = "newest") => {
    const dir = path.join(dataDir, folder);
    const names = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    return (order === "newest" ? datedFiles(names, asOf) : datedFilesOldestFirst(names, asOf)).map((name) => `${folder}/${name}`);
  };
  const readInput = <T>(rel: string): { value: T; input: Input } => {
    const text = fs.readFileSync(path.join(dataDir, rel), "utf8");
    return { value: JSON.parse(text) as T, input: { path: `data/${rel}`, sha256: sha256Hex(text) } };
  };

  // Every checks file up to as-of, oldest first; the last one is the current file.
  const historyFiles = datedIn("checks", "oldest");
  if (historyFiles.length === 0) throw new Error(`No data/checks/YYYY-MM-DD.json dated on or before ${asOf}. Run: npm run check:assets`);
  const history = historyFiles.map((file) => ({ file, ...readInput<{ checked_at: string; results: Omit<ChecksRow, "file">[] }>(file) }));
  const checks = history[history.length - 1];
  const previous = history.length > 1 ? history[history.length - 2] : null;

  const [examFile] = datedIn("examinations");
  const exam = examFile ? readInput<{ checked_at: string; checks: CheckResult[] }>(examFile) : null;
  const [issuanceFile] = datedIn("monitor/issuance");
  const issuance = issuanceFile ? readInput<unknown>(issuanceFile) : null;
  const issuanceData = issuance ? parseIssuance(issuance.value) : null;
  const claims = readInput<Claim[]>("claims/claims.json");
  const sources = readInput<StoredSourceFact[]>("claims/sources.json");
  const snapshots = readInput<SnapshotRecord[]>("snapshots/index.json");
  const reviewsFile = path.join(dataDir, "review", "flags.json");
  const reviews = fs.existsSync(reviewsFile) ? readInput<unknown>("review/flags.json") : null;
  const reviewList: Review[] = reviews ? parseReviews(reviews.value) : [];

  const run = {
    asOf,
    checks: toRows(checks.file, checks.value.results),
    earlierChecks: history.slice(0, -1).map((h) => toRows(h.file, h.value.results)),
    examinations: exam && examFile ? { file: `data/${examFile}`, checks: exam.value.checks } : null,
    claims: claims.value,
    sources: sources.value,
    snapshots: snapshots.value,
    issuance: issuance && issuanceData && issuanceFile ? { file: `data/${issuanceFile}`, data: issuanceData } : null,
  };

  const withTime = (i: { input: Input; value: { checked_at: string } }) => ({ ...i.input, checked_at: i.value.checked_at });
  const inputs = {
    checks: withTime(checks),
    previous_checks: previous ? withTime(previous) : null,
    checks_history: history.map(withTime),
    examinations: exam ? withTime(exam) : null,
    claims: claims.input,
    sources: sources.input,
    snapshots: snapshots.input,
    issuance: issuance && issuanceData ? { ...issuance.input, generated_at: issuanceData.generated_at } : null,
    reviews: reviews ? reviews.input : null,
  };
  const fileFields = { feed_schema: FEED_SCHEMA, rules_version: RULES_VERSION, inputs };

  const assets: AssetStatus[] = universe.map((asset) =>
    assetStatus(asset, evaluateAsset(asset, run), reviewList, assetContext(asset, seriesFor(asset, run), fileFields)),
  );

  return {
    generated_at: opts.now.toISOString(),
    as_of: asOf,
    feed_schema: FEED_SCHEMA,
    rules_version: RULES_VERSION,
    inputs,
    bits: FLAG_BITS,
    status_codes: STATUS_CODES,
    summary: {
      OK: assets.filter((a) => a.status === "OK").length,
      WARNING: assets.filter((a) => a.status === "WARNING").length,
      CRITICAL: assets.filter((a) => a.status === "CRITICAL").length,
      unpublished: assets.filter((a) => a.status === null).length,
      pending_review: assets.reduce((n, a) => n + a.raised.filter((r) => r.review === "pending").length, 0),
    },
    assets,
  };
}

/** `--out <file>` from the arguments, resolved; null when absent. A path inside data/ is refused (a dry recompute never writes evidence). */
export function resolveOut(argv: readonly string[], dataDir: string): string | null {
  const i = argv.indexOf("--out");
  if (i < 0) return null;
  const value = argv[i + 1];
  if (!value || value.startsWith("--")) throw new Error("--out needs a file path");
  const abs = path.resolve(value);
  const rel = path.relative(path.resolve(dataDir), abs);
  if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) throw new Error(`--out must be outside data/ (got ${value})`);
  return abs;
}
