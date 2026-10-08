/**
 * The benchmark's document set and extraction windows. It repeats the
 * candidate filter and chunk selection of `extract:claims` (which this
 * deliverable must not change), so both models see exactly what production
 * extraction would send. Keep MIN_HTML_CHARS and OUTPUT_TOKENS in sync with
 * scripts/extract-claims.ts.
 */
import fs from "node:fs";
import path from "node:path";
import type { createContextFactory } from "../claims/context";
import { selectChunks, type Chunk } from "../claims/select";
import { docKey } from "../claims/store";
import type { AssetRef, VerifyContext } from "../claims/verify";
import type { SnapshotRecord, SnapshotStore } from "../documents/store";
import { reviewId } from "../review/queue";

export const MIN_HTML_CHARS = 1500;
export const OUTPUT_TOKENS = 4096;

export type BenchDoc = {
  /** `reviewId(doc_key)`, the id the review queue uses. */
  id: string;
  doc_key: string;
  url: string;
  kind: string;
  assets: AssetRef[];
  snapshot_sha256: string;
  text_sha256: string;
  chunks: Chunk[];
  total_chunks: number;
  window_chars: number;
  full_chars: number;
  ctx: VerifyContext;
  record: SnapshotRecord;
};

/** The window exactly as it is sent: `[label]` line, chunk text, chunks joined by a blank line. */
export const windowText = (chunks: Chunk[]) => chunks.map((c) => `[${c.label}]\n${c.text}`).join("\n\n");

/** Issuer documents `extract:claims` would send: issuer or issuer_toml, with text, HTML of at least MIN_HTML_CHARS, one per doc_key. */
export function prepareDocs(snapshots: SnapshotStore, factory: ReturnType<typeof createContextFactory>) {
  const seen = new Set<string>();
  const docs: BenchDoc[] = [];
  const stale: string[] = [];
  for (const record of snapshots.all()) {
    if (record.sourceClass !== "issuer" && record.sourceClass !== "issuer_toml") continue;
    if (!record.text || (record.text.kind === "html" && record.text.chars < MIN_HTML_CHARS)) continue;
    const key = docKey(record.sha256, record.assets);
    if (seen.has(key)) continue;
    seen.add(key);
    const prepared = factory.contextFor(record);
    if (!prepared) {
      stale.push(record.url);
      continue;
    }
    const terms = prepared.ctx.assets.flatMap((a) => [a.code, a.name ?? ""]);
    const selection = selectChunks(prepared.text, record.text.kind, terms);
    docs.push({
      id: reviewId(key), doc_key: key, url: record.url, kind: record.text.kind, assets: prepared.ctx.assets, snapshot_sha256: record.sha256,
      text_sha256: record.text.sha256, chunks: selection.chunks, total_chunks: selection.totalChunks, window_chars: selection.chars,
      full_chars: record.text.chars, ctx: prepared.ctx, record,
    });
  }
  return { docs, stale };
}

/** Write each window as sent plus manifest.json (the files the operator labels the gold set from). */
export function writeWindows(dir: string, docs: BenchDoc[]) {
  fs.mkdirSync(dir, { recursive: true });
  for (const d of docs) fs.writeFileSync(path.join(dir, `${d.id}.txt`), windowText(d.chunks));
  const manifest = docs.map((d) => ({
    id: d.id, doc_key: d.doc_key, url: d.url, kind: d.kind, assets: d.assets, window: d.chunks.map((c) => c.label), window_chars: d.window_chars,
    full_chars: d.full_chars, text_file: `data/snapshots/text/windows/${d.id}.txt`,
  }));
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
}
