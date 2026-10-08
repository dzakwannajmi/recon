/**
 * Status v1: decide every flag for every pinned asset from the stored run
 * files and write the status that the feed will publish. Deterministic:
 * no network, no LLM, no env file.
 *
 *   npm run status [-- --as-of YYYY-MM-DD]
 *
 * Reads (repo-relative to data/):
 *   checks/YYYY-MM-DD.json         newest dated <= as-of (current) and the one before it (previous)
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
import { evaluateAsset } from "../lib/flags/evaluate";
import { assetStatus, parseReviews, type AssetStatus, type Review } from "../lib/flags/status";
import { FLAG_BITS, RULES_VERSION, STATUS_CODES, type ChecksRow } from "../lib/flags/types";

const DATA = path.join(process.cwd(), "..", "data");
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function writeJson(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

function parseAsOf(argv: string[]) {
  const i = argv.indexOf("--as-of");
  const value = i >= 0 ? argv[i + 1] : new Date().toISOString().slice(0, 10);
  if (!value || !DAY.test(value) || Number.isNaN(Date.parse(value))) throw new Error("--as-of must be a date in the form YYYY-MM-DD");
  return value;
}

/** Dated files of a folder (YYYY-MM-DD.json) up to and including as-of, newest first. */
function datedFiles(folder: string, asOf: string) {
  const dir = path.join(DATA, folder);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .map((name) => /^(\d{4}-\d{2}-\d{2})\.json$/.exec(name)?.[1])
    .filter((date): date is string => !!date && date <= asOf)
    .sort()
    .reverse()
    .map((date) => `${folder}/${date}.json`);
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

  const [checksFile, previousFile] = datedFiles("checks", asOf);
  if (!checksFile) throw new Error(`No data/checks/YYYY-MM-DD.json dated on or before ${asOf}. Run: npm run check:assets`);
  const checks = readInput<{ checked_at: string; results: Omit<ChecksRow, "file">[] }>(checksFile);
  const previous = previousFile ? readInput<{ checked_at: string; results: Omit<ChecksRow, "file">[] }>(previousFile) : null;

  const [examFile] = datedFiles("examinations", asOf);
  const exam = examFile ? readInput<{ checked_at: string; checks: CheckResult[] }>(examFile) : null;
  const claims = readInput<Claim[]>("claims/claims.json");
  const sources = readInput<StoredSourceFact[]>("claims/sources.json");
  const snapshots = readInput<SnapshotRecord[]>("snapshots/index.json");
  const reviewsFile = path.join(DATA, "review", "flags.json");
  const reviews = fs.existsSync(reviewsFile) ? readInput<unknown>("review/flags.json") : null;
  const reviewList: Review[] = reviews ? parseReviews(reviews.value) : [];

  const run = {
    asOf,
    checks: toRows(checksFile, checks.value.results),
    previousChecks: previous && previousFile ? toRows(previousFile, previous.value.results) : null,
    examinations: exam && examFile ? { file: `data/${examFile}`, checks: exam.value.checks } : null,
    claims: claims.value,
    sources: sources.value,
    snapshots: snapshots.value,
  };

  const assets: AssetStatus[] = universe.map((asset) => assetStatus(asset, evaluateAsset(asset, run), reviewList));

  const summary = {
    OK: assets.filter((a) => a.status === "OK").length,
    WARNING: assets.filter((a) => a.status === "WARNING").length,
    CRITICAL: assets.filter((a) => a.status === "CRITICAL").length,
    unpublished: assets.filter((a) => a.status === null).length,
    pending_review: assets.reduce((n, a) => n + a.raised.filter((r) => r.review === "pending").length, 0),
  };

  const withTime = (i: { input: Input; value: { checked_at: string } }) => ({ ...i.input, checked_at: i.value.checked_at });
  writeJson(path.join(DATA, "status", `${asOf}.json`), {
    generated_at: new Date().toISOString(),
    as_of: asOf,
    rules_version: RULES_VERSION,
    inputs: {
      checks: withTime(checks),
      previous_checks: previous ? withTime(previous) : null,
      examinations: exam ? withTime(exam) : null,
      claims: claims.input,
      sources: sources.input,
      snapshots: snapshots.input,
      reviews: reviews ? reviews.input : null,
    },
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
