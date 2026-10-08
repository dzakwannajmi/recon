import { describe, expect, it } from "vitest";
import type { SnapshotRecord } from "../documents/store";
import { docKey, type DroppedClaim, type ExtractionRun } from "../claims/store";
import { buildQueue, reviewId, type ImportLogEntry, type ProposalState, type QueueEntry } from "./queue";

const rec = (n: number, textHash = `t${n}`): SnapshotRecord =>
  ({
    sha256: `s${n}`, url: `https://x.com/${n}.pdf`, sourceClass: "issuer", assets: [`A${n}:G${n}`],
    text: { kind: "pdf", chars: 100 + n, pages: 2, sha256: textHash, extractor: "x" },
  }) as unknown as SnapshotRecord;
const run = (n: number, over: Partial<ExtractionRun> = {}): ExtractionRun => {
  const r = rec(n);
  return {
    key: `k${n}`, doc_key: docKey(r.sha256, r.assets), snapshot_sha256: r.sha256, text_sha256: r.text!.sha256, source_url: r.url, chunks_sent: 1, chars_sent: 1,
    proposals: [], verified: 0, dropped: 0, tokens: 1, error: null, model: "m", prompt_version: "p", at: "2026-10-01T00:00:00.000Z", ...over,
  };
};
const now = "2026-10-08T00:00:00.000Z";
const records = [rec(1), rec(2), rec(3), rec(4)];
const idOf = (n: number) => reviewId(run(n).doc_key);
const base = { records, names: new Map([["A1:G1", "Alpha"]]), proposals: {}, imports: [], previous: [], now };

describe("buildQueue", () => {
  it("includes errors and zero-verified runs, not runs with verified claims, sorted by id", () => {
    const runs = [run(1, { error: "boom" }), run(2), run(3, { verified: 2 })];
    const { entries } = buildQueue({ ...base, runs });
    expect(entries.map((e) => e.reason).sort()).toEqual(["llm_error", "no_verified_claims"]);
    expect(entries.map((e) => e.id)).toEqual([idOf(1), idOf(2)].sort());
    const e = entries.find((x) => x.id === idOf(1))!;
    expect(e).toMatchObject({
      status: "open", queued_at: now, source_url: "https://x.com/1.pdf", kind: "pdf", chars: 101, pages: 2, text_file: "data/snapshots/text/s1.txt",
      proposals_file: `data/review/proposals/${idOf(1)}.json`, assets: [{ key: "A1:G1", code: "A1", name: "Alpha" }], run: { error: "boom", proposals: 0 },
    });
  });

  it("counts LLM drops per reason and keeps the order stable", () => {
    const dropped = [{ doc_key: run(1).doc_key, reason: "quote_not_found" }, { doc_key: run(1).doc_key, reason: "quote_not_found" }, { doc_key: run(1).doc_key, reason: "field_gate" }] as DroppedClaim[];
    const { entries } = buildQueue({ ...base, runs: [run(1)], dropped });
    expect(entries[0].run.dropped_reasons).toEqual({ field_gate: 1, quote_not_found: 2 });
  });

  it("keeps an entry that has a proposals file even when the run now has claims, with its old reason", () => {
    const state: ProposalState = { file_sha256: "f", text_sha256: "t3", refused: null };
    const previous = [{ id: idOf(3), reason: "llm_error", queued_at: "2026-10-02T00:00:00.000Z" }] as QueueEntry[];
    const { entries } = buildQueue({ ...base, runs: [run(3, { verified: 2 })], proposals: { [idOf(3)]: state }, previous });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ reason: "llm_error", queued_at: "2026-10-02T00:00:00.000Z", status: "proposed" });
  });

  it("does not enrol a run with claims just because it has a proposals file, unless it was already queued", () => {
    const state: ProposalState = { file_sha256: "f", text_sha256: "t3", refused: null };
    expect(buildQueue({ ...base, runs: [run(3, { verified: 2 })], proposals: { [idOf(3)]: state } }).entries).toEqual([]);
  });

  it("skips (and reports) a run whose snapshot record is missing", () => {
    const { entries, skipped } = buildQueue({ ...base, runs: [run(9)] });
    expect(entries).toEqual([]);
    expect(skipped[0]).toContain("https://x.com/9.pdf");
  });

  it("derives every status", () => {
    const runs = [1, 2, 3, 4, 5].map((n) => run(n));
    const recs = [...records, rec(5)];
    const proposals: Record<string, ProposalState> = {
      [idOf(2)]: { file_sha256: "f2", text_sha256: "t2", refused: null }, // proposed (no log)
      [idOf(3)]: { file_sha256: "f3", text_sha256: "t3", refused: null }, // imported
      [idOf(4)]: { file_sha256: "f4", text_sha256: "OLD", refused: null }, // stale
      [idOf(5)]: { file_sha256: "f5", text_sha256: null, refused: "bad" }, // refused
    };
    const log = (n: number, file: string, status: ImportLogEntry["status"]) => ({ id: idOf(n), proposals_sha256: file, status }) as ImportLogEntry;
    const imports = [log(3, "f3", "imported"), log(2, "OTHER", "imported")];
    const status = (text?: (r: SnapshotRecord) => boolean) =>
      Object.fromEntries(buildQueue({ ...base, runs, records: recs, proposals, imports, textValid: text }).entries.map((e) => [e.id, e.status]));
    expect(status()).toEqual({ [idOf(1)]: "open", [idOf(2)]: "proposed", [idOf(3)]: "imported", [idOf(4)]: "stale", [idOf(5)]: "refused" });
    // The text no longer verifies: an imported file turns stale.
    expect(status((r) => r.sha256 !== "s3")[idOf(3)]).toBe("stale");
  });

  it("keeps queued_at from the previous queue", () => {
    const first = buildQueue({ ...base, runs: [run(1), run(2)] }).entries;
    const later = buildQueue({ ...base, runs: [run(1), run(2), run(4)], previous: first, now: "2026-10-09T00:00:00.000Z" }).entries;
    expect(later.find((e) => e.id === idOf(1))!.queued_at).toBe(now);
    expect(later.find((e) => e.id === idOf(4))!.queued_at).toBe("2026-10-09T00:00:00.000Z");
  });
});
