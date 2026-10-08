/**
 * Operator review queue (pure). A document whose automated extraction failed
 * or gave no verified claim is queued; the operator reads its snapshot text
 * outside the app and writes a proposals file (see proposals.ts). The queue
 * only lists work and statuses; it never decides anything about a claim.
 */
import { createHash } from "node:crypto";
import type { SnapshotRecord } from "../documents/store";
import { docKey, type DroppedClaim, type ExtractionRun } from "../claims/store";

export const REVIEW_VERSION = "review-v1";

export type QueueReason = "llm_error" | "no_verified_claims";
/** open: no proposals file. proposed: file not imported yet. imported: this exact file was imported. stale: the text changed since the operator read it. refused: the file failed validation. */
export type QueueStatus = "open" | "proposed" | "imported" | "stale" | "refused";

/** What the importer wrote for one proposals file (data/review/imports.json). */
export type ImportLogEntry = {
  id: string;
  doc_key: string;
  proposals_sha256: string;
  text_sha256: string | null;
  imported_at: string;
  status: "imported" | "stale" | "refused";
  reason?: string;
  proposed: number;
  verified: number;
  claim_ids: string[];
  skipped_duplicates: string[];
  dropped: { field: string; asset_code: string; reason: string; value_text: string; quote: string }[];
};

/** What the queue needs to know about one proposals file on disk. */
export type ProposalState = { file_sha256: string; /** From the file; null if it could not be parsed. */ text_sha256: string | null; /** Why validation failed, or null. */ refused: string | null };

export type QueueEntry = {
  id: string;
  doc_key: string;
  reason: QueueReason;
  status: QueueStatus;
  queued_at: string;
  source_url: string;
  source_class: string;
  kind: string;
  chars: number;
  pages: number | null;
  snapshot_sha256: string;
  text_sha256: string;
  extractor: string;
  assets: { key: string; code: string; name: string | null }[];
  text_file: string;
  proposals_file: string;
  run: { model: string; prompt_version: string; at: string; proposals: number; verified: number; dropped_reasons: Record<string, number>; error: string | null };
};

/** A run belongs in the queue when the LLM failed or gave no verified claim. */
export const queueReason = (run: ExtractionRun): QueueReason | null => (run.error !== null ? "llm_error" : run.verified === 0 ? "no_verified_claims" : null);

export const reviewId = (key: string) => createHash("sha256").update(key).digest("hex").slice(0, 16);

export type QueueInput = {
  runs: readonly ExtractionRun[];
  records: readonly SnapshotRecord[];
  names: ReadonlyMap<string, string>;
  /** The LLM drops (data/claims/dropped.json), only to count reasons per document. */
  dropped?: readonly DroppedClaim[];
  /** Proposals files by review id. */
  proposals: Readonly<Record<string, ProposalState>>;
  imports: readonly ImportLogEntry[];
  previous: readonly QueueEntry[];
  /** False when the stored text no longer matches its hash or extractor (default: true). */
  textValid?: (record: SnapshotRecord) => boolean;
  now: string;
};

export function statusOf(
  proposal: ProposalState | undefined,
  record: SnapshotRecord,
  log: ImportLogEntry | undefined,
  textValid: boolean,
): QueueStatus {
  if (!proposal) return "open";
  if (proposal.refused !== null) return "refused";
  if (proposal.text_sha256 !== record.text?.sha256 || !textValid) return "stale";
  return log && log.proposals_sha256 === proposal.file_sha256 && log.status === "imported" ? "imported" : "proposed";
}

export function buildQueue(input: QueueInput): { entries: QueueEntry[]; skipped: string[] } {
  const entries: QueueEntry[] = [];
  const skipped: string[] = [];
  for (const run of input.runs) {
    const id = reviewId(run.doc_key);
    const proposal = input.proposals[id];
    const before = input.previous.find((e) => e.id === id);
    const found = queueReason(run);
    // A document already in the queue with a proposals file stays even if a later LLM run now has claims; it keeps its original reason.
    if (found === null && !(proposal && before)) continue;
    const record = input.records.find((r) => docKey(r.sha256, r.assets) === run.doc_key);
    if (!record || !record.text) {
      skipped.push(`${run.source_url} (snapshot or text missing)`);
      continue;
    }
    const dropped_reasons: Record<string, number> = {};
    for (const d of input.dropped ?? []) if (d.doc_key === run.doc_key) dropped_reasons[d.reason] = (dropped_reasons[d.reason] ?? 0) + 1;
    entries.push({
      id,
      doc_key: run.doc_key,
      reason: found ?? before?.reason ?? "no_verified_claims",
      status: statusOf(proposal, record, input.imports.find((l) => l.id === id), input.textValid?.(record) ?? true),
      queued_at: before?.queued_at ?? input.now,
      source_url: record.url, source_class: record.sourceClass, kind: record.text.kind, chars: record.text.chars, pages: record.text.pages,
      snapshot_sha256: record.sha256, text_sha256: record.text.sha256, extractor: record.text.extractor,
      assets: record.assets.map((key) => ({ key, code: key.split(":")[0], name: input.names.get(key) ?? null })),
      text_file: `data/snapshots/text/${record.sha256}.txt`,
      proposals_file: `data/review/proposals/${id}.json`,
      run: {
        model: run.model, prompt_version: run.prompt_version, at: run.at, proposals: run.proposals.length, verified: run.verified,
        dropped_reasons: Object.fromEntries(Object.entries(dropped_reasons).sort(([a], [b]) => a.localeCompare(b))), error: run.error,
      },
    });
  }
  return { entries: entries.sort((a, b) => a.id.localeCompare(b.id)), skipped };
}
