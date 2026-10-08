import type { SnapshotRecord } from "../documents/store";
import { clear, notEvaluated, raised, type Evaluation, type EvidenceRef } from "./types";

/** HTML below this many characters of text is a shell or error page, not a document. */
export const MIN_HTML_CHARS = 1500;

/** A snapshot counts as a document when it is an issuer or regulatory file with readable text. */
export function isReadableDocument(r: SnapshotRecord): boolean {
  if (r.sourceClass !== "issuer" && r.sourceClass !== "regulatory_filing") return false;
  if (!r.text) return false;
  return r.text.kind === "pdf" || r.text.kind === "xml" || (r.text.kind === "html" && r.text.chars >= MIN_HTML_CHARS);
}

/**
 * NO_PUBLIC_DOCS (WARNING only). `snapshots` are the current records (see
 * currentRecords). Tomls don't count: they hold no attestation. Not evaluated
 * when no toml snapshot exists, because then documents were never collected.
 */
export function flagNoPublicDocs(snapshots: readonly SnapshotRecord[], assetKey: string): Evaluation {
  const mine = snapshots.filter((r) => r.assets.includes(assetKey));
  if (!mine.some((r) => r.sourceClass === "issuer_toml")) return notEvaluated("NO_PUBLIC_DOCS", "Documents have not been collected for this asset");
  const asOf = mine.map((r) => r.lastSeenAt.slice(0, 10)).sort().at(-1)!;
  const ref = (r: SnapshotRecord): EvidenceRef => ({ kind: "snapshot", ref: r.sha256, source_url: r.url, snapshot_sha256: r.sha256 });
  const counting = mine.filter(isReadableDocument);
  if (counting.length > 0) {
    const kinds = [...new Set(counting.map((r) => r.text!.kind))].sort().join(", ");
    return clear("NO_PUBLIC_DOCS", `${counting.length} issuer or regulatory document${counting.length === 1 ? "" : "s"} with readable text (${kinds}) as of ${asOf}.`, asOf, counting.map(ref));
  }
  const pages = mine.filter((r) => r.sourceClass === "issuer" || r.sourceClass === "regulatory_filing");
  const code = assetKey.split(":")[0];
  const detail = pages.length === 0
    ? "no issuer page or filing was fetched"
    : `${pages.length} page(s) fetched from the issuer's site, the largest with ${Math.max(...pages.map((r) => r.text?.chars ?? 0))} characters of text`;
  return raised("NO_PUBLIC_DOCS", "WARNING", `No issuer document or regulatory filing with readable text was found for ${code} as of ${asOf}: ${detail}.`, asOf, pages.map(ref));
}
