import { clear, notEvaluated, raised, type Evaluation, type EvidenceRef } from "./types";

/**
 * Days a report date stays fresh, by where it was found (D-035). A filing's
 * cadence sets how old its newest public report can honestly be: N-MFP3 is
 * monthly (filed within 5 business days); only quarter-end NPORT-P reports are
 * public (92 + 60 days + slack); an issuer document is held to the monthly window.
 */
export const STALE_WINDOWS: Record<string, number> = { "N-MFP3": 45, "NPORT-P": 160, issuer_document: 45 };

/** Asset types that are expected to publish periodic attestations in v1. */
const PERIODIC_TYPES = ["fund", "yield-bearing"];

export type ReportDate = {
  /** YYYY-MM-DD */
  date: string;
  /** SEC form without "/A", or null for a verified issuer document. */
  form: string | null;
  label: string;
  source_url: string;
  evidence: EvidenceRef;
};

const DAY_MS = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);
const windowFor = (r: ReportDate) => (r.form === null ? STALE_WINDOWS.issuer_document : STALE_WINDOWS[r.form]);
const windowName = (r: ReportDate) => r.form ?? "issuer documents";

/**
 * STALE_ATTESTATION (WARNING only): stale only when no report date is inside
 * its own window. Future dates, malformed dates, and unknown forms are ignored.
 */
export function flagStaleAttestation(input: { assetType: string; reports: readonly ReportDate[]; asOf: string }): Evaluation {
  const { assetType, reports, asOf } = input;
  if (!PERIODIC_TYPES.includes(assetType)) {
    return notEvaluated("STALE_ATTESTATION", `No periodic attestation window is defined for asset type ${assetType} in v1`);
  }
  const usable = reports
    .filter((r) => ISO_DAY.test(r.date) && r.date <= asOf && windowFor(r) !== undefined)
    .sort((a, b) => b.date.localeCompare(a.date));
  if (usable.length === 0) {
    const future = reports.filter((r) => ISO_DAY.test(r.date) && r.date > asOf);
    const note = future.length > 0 ? ` (ignored ${future.length} report date${future.length === 1 ? "" : "s"} after ${asOf}: ${future.map((r) => r.date).join(", ")})` : "";
    return notEvaluated("STALE_ATTESTATION", `No report date found in filings or verified issuer claims${note}`);
  }
  const age = (r: ReportDate) => daysBetween(r.date, asOf);
  const inside = usable.find((r) => age(r) <= windowFor(r));
  if (inside) {
    return clear(
      "STALE_ATTESTATION",
      `Newest report date ${inside.date} (${inside.label}) is ${age(inside)} days before ${asOf}, inside the ${windowFor(inside)}-day window for ${windowName(inside)}.`,
      asOf, [inside.evidence],
    );
  }
  const newest = usable[0];
  return raised(
    "STALE_ATTESTATION", "WARNING",
    `The newest report date found is ${newest.date} (${newest.label}, ${newest.source_url}), ${age(newest)} days before ${asOf}; the window for ${windowName(newest)} is ${windowFor(newest)} days.`,
    asOf, [newest.evidence],
  );
}
