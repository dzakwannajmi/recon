/** Pure helpers that pick one asset's inputs from the parsed run files. */
import type { Claim } from "../claims/store";
import type { SnapshotRecord } from "../documents/store";
import type { CheckResult } from "../examine/checks";
import type { StoredSourceFact } from "../examine/sources";
import type { ReportDate } from "./stale";
import { isIsoDay, type ChecksRow, type ExamCheck } from "./types";

/** Report dates for one asset: from filings read by code, and from verified issuer claims. */
export function reportDatesFor(assetKey: string, sources: readonly StoredSourceFact[], claims: readonly Claim[], snapshots: readonly SnapshotRecord[]): ReportDate[] {
  const out: ReportDate[] = [];
  for (const f of sources) {
    if (f.asset !== assetKey || f.field !== "report_date" || typeof f.value !== "string") continue;
    const form = snapshots.find((s) => s.sha256 === f.snapshot_sha256)?.filing?.form.replace(/\/A$/, "") ?? null;
    if (form === null) continue; // not a filing: no window to judge it by
    if (!isIsoDay(f.value)) continue; // a malformed date in a stored fact is never trusted
    out.push({
      date: f.value, form, label: f.label, source_url: f.source_url,
      evidence: { kind: "source_fact", ref: `${f.snapshot_sha256}#${f.section}`, source_url: f.source_url, snapshot_sha256: f.snapshot_sha256, quote: f.quote, where: f.section },
    });
  }
  for (const c of claims) {
    if (c.asset !== assetKey || c.field !== "report_date" || c.verified !== true) continue;
    const date = [c.value, c.as_of].find((v): v is string => typeof v === "string" && isIsoDay(v));
    if (!date) continue;
    out.push({
      date, form: null, label: `issuer document ${c.source_url}, page ${c.page ?? "n/a"}`, source_url: c.source_url,
      evidence: { kind: "claim", ref: c.id, source_url: c.source_url, snapshot_sha256: c.snapshot_sha256, quote: c.quote, where: c.page ? `page ${c.page}` : null },
    });
  }
  return out;
}

/** The checks row of one asset (CODE and issuer must both match). */
export const rowFor = (rows: readonly ChecksRow[], code: string, issuer: string) => rows.find((r) => r.asset_code === code && r.issuer === issuer);

/** The examination checks of one asset, each tagged with the file they came from. */
export const examChecksFor = (checks: readonly CheckResult[], assetKey: string, file: string): ExamCheck[] =>
  checks.filter((c) => c.asset === assetKey).map((c) => ({ ...c, file }));

/** `--as-of YYYY-MM-DD` from the arguments (default: today, UTC); an invalid date is an error. */
export function parseAsOf(argv: readonly string[], today = new Date().toISOString().slice(0, 10)): string {
  const i = argv.indexOf("--as-of");
  const value = i >= 0 ? argv[i + 1] : today;
  if (!value || !isIsoDay(value)) throw new Error("--as-of must be a real date in the form YYYY-MM-DD");
  return value;
}

/** The same dated files, oldest first (the order of a checks history: the current file is last). */
export const datedFilesOldestFirst = (names: readonly string[], asOf: string): string[] => datedFiles(names, asOf).reverse();

/** From the file names of a folder, the dated ones (YYYY-MM-DD.json) up to and including as-of, newest first. */
export function datedFiles(names: readonly string[], asOf: string): string[] {
  return names
    .map((name) => /^(\d{4}-\d{2}-\d{2})\.json$/.exec(name)?.[1])
    .filter((date): date is string => !!date && isIsoDay(date) && date <= asOf)
    .sort()
    .reverse()
    .map((date) => `${date}.json`);
}
