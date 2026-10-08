/** Pure helpers that pick one asset's inputs from the parsed run files. */
import type { Claim } from "../claims/store";
import type { SnapshotRecord } from "../documents/store";
import type { CheckResult } from "../examine/checks";
import type { StoredSourceFact } from "../examine/sources";
import type { ReportDate } from "./stale";
import type { ChecksRow, ExamCheck } from "./types";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Report dates for one asset: from filings read by code, and from verified issuer claims. */
export function reportDatesFor(assetKey: string, sources: readonly StoredSourceFact[], claims: readonly Claim[], snapshots: readonly SnapshotRecord[]): ReportDate[] {
  const out: ReportDate[] = [];
  for (const f of sources) {
    if (f.asset !== assetKey || f.field !== "report_date" || typeof f.value !== "string") continue;
    const form = snapshots.find((s) => s.sha256 === f.snapshot_sha256)?.filing?.form.replace(/\/A$/, "") ?? null;
    if (form === null) continue; // not a filing: no window to judge it by
    out.push({
      date: f.value, form, label: f.label, source_url: f.source_url,
      evidence: { kind: "source_fact", ref: `${f.snapshot_sha256}#${f.section}`, source_url: f.source_url, snapshot_sha256: f.snapshot_sha256, quote: f.quote, where: f.section },
    });
  }
  for (const c of claims) {
    if (c.asset !== assetKey || c.field !== "report_date" || c.verified !== true) continue;
    const date = [c.value, c.as_of].find((v): v is string => typeof v === "string" && ISO_DAY.test(v));
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
