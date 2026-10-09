/**
 * Status v1: decide every flag for every pinned asset from the stored run
 * files and write the status that the feed will publish. Deterministic:
 * no network, no LLM, no env file.
 *
 *   npm run status [-- --as-of YYYY-MM-DD]
 *
 * Reads (repo-relative to data/):
 *   checks/YYYY-MM-DD.json         every file dated <= as-of, oldest first; the newest is the current one (D-038 hold window)
 *   examinations/YYYY-MM-DD.json   newest dated <= as-of
 *   claims/claims.json, claims/sources.json, snapshots/index.json
 *   review/flags.json              optional operator confirmations
 * Writes data/status/YYYY-MM-DD.json (atomically).
 */
import fs from "fs";
import path from "path";
import { loadUniverse } from "../lib/chain/universe";
import type { Claim } from "../lib/claims/store";
import { sha256Hex, type SnapshotRecord } from "../lib/documents/store";
import type { CheckResult } from "../lib/examine/checks";
import type { StoredSourceFact } from "../lib/examine/sources";
import { evaluateAsset, seriesFor } from "../lib/flags/evaluate";
import { assetContext } from "../lib/flags/feed";
import { datedFiles, datedFilesOldestFirst, parseAsOf } from "../lib/flags/inputs";
import { assetStatus, parseReviews, type AssetStatus, type Review } from "../lib/flags/status";
import { FEED_SCHEMA, FLAG_BITS, RULES_VERSION, STATUS_CODES, type ChecksRow } from "../lib/flags/types";

const DATA = path.join(process.cwd(), "..", "data");

function writeJson(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

/** The dated files of a folder up to as-of, newest first (or oldest first), as `folder/YYYY-MM-DD.json`. */
function datedFilesIn(folder: string, asOf: string, order: "newest" | "oldest" = "newest") {
  const dir = path.join(DATA, folder);
  const names = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  return (order === "newest" ? datedFiles(names, asOf) : datedFilesOldestFirst(names, asOf)).map((name) => `${folder}/${name}`);
}

type Input = { path: string; sha256: string };

function readInput<T>(rel: string): { value: T; input: Input } {
  const text = fs.readFileSync(path.join(DATA, rel), "utf8");
  return { value: JSON.parse(text) as T, input: { path: `data/${rel}`, sha256: sha256Hex(text) } };
}

const toRows = (file: string, results: Omit<ChecksRow, "file">[]): ChecksRow[] => results.map((r) => ({ ...r, file: `data/${file}` }));

function main() {
  const asOf = parseAsOf(process.argv.slice(2));
  const universe = loadUniverse();
  if (universe.length === 0) throw new Error("data/assets.csv is missing or empty");

  // Every checks file up to as-of, oldest first; the last one is the current file.
  const historyFiles = datedFilesIn("checks", asOf, "oldest");
  if (historyFiles.length === 0) throw new Error(`No data/checks/YYYY-MM-DD.json dated on or before ${asOf}. Run: npm run check:assets`);
  const history = historyFiles.map((file) => ({ file, ...readInput<{ checked_at: string; results: Omit<ChecksRow, "file">[] }>(file) }));
  const checks = history[history.length - 1];
  const previous = history.length > 1 ? history[history.length - 2] : null;

  const [examFile] = datedFilesIn("examinations", asOf);
  const exam = examFile ? readInput<{ checked_at: string; checks: CheckResult[] }>(examFile) : null;
  const claims = readInput<Claim[]>("claims/claims.json");
  const sources = readInput<StoredSourceFact[]>("claims/sources.json");
  const snapshots = readInput<SnapshotRecord[]>("snapshots/index.json");
  const reviewsFile = path.join(DATA, "review", "flags.json");
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
    reviews: reviews ? reviews.input : null,
  };
  const fileFields = { feed_schema: FEED_SCHEMA, rules_version: RULES_VERSION, inputs };

  const assets: AssetStatus[] = universe.map((asset) =>
    assetStatus(asset, evaluateAsset(asset, run), reviewList, assetContext(asset, seriesFor(asset, run), fileFields)),
  );

  const summary = {
    OK: assets.filter((a) => a.status === "OK").length,
    WARNING: assets.filter((a) => a.status === "WARNING").length,
    CRITICAL: assets.filter((a) => a.status === "CRITICAL").length,
    unpublished: assets.filter((a) => a.status === null).length,
    pending_review: assets.reduce((n, a) => n + a.raised.filter((r) => r.review === "pending").length, 0),
  };

  writeJson(path.join(DATA, "status", `${asOf}.json`), {
    generated_at: new Date().toISOString(),
    as_of: asOf,
    feed_schema: FEED_SCHEMA,
    rules_version: RULES_VERSION,
    inputs,
    bits: FLAG_BITS,
    status_codes: STATUS_CODES,
    summary,
    assets,
  });

  for (const a of assets) {
    const flags = a.raised.map((r) => `${r.flag}${r.review === "pending" ? " (pending review)" : ""}`).join(", ");
    console.log(`${a.asset_code.padEnd(8)} ${(a.status ?? "unpublished").padEnd(11)} ${flags || "-"}`);
  }
  console.log(`\nas of ${asOf}: ${summary.OK} OK, ${summary.WARNING} WARNING, ${summary.CRITICAL} CRITICAL, ${summary.unpublished} unpublished, ${summary.pending_review} pending review`);
  console.log(`wrote data/status/${asOf}.json`);
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
