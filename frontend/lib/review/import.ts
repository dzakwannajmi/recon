/**
 * Import operator proposals through the same verifier and claim builder as
 * `extract:claims` (golden rules 1 and 2): the operator picks the field and
 * the quote; code checks the quote, value, as-of date, page, and unit. A
 * proposal is data, never a status or a flag. Drops stay in the import log,
 * not in data/claims/dropped.json (that file is LLM-only, for the W2.6 metrics).
 */
import path from "node:path";
import { buildClaims } from "../claims/claim";
import type { Claim } from "../claims/store";
import { verifyClaim, type VerifyContext } from "../claims/verify";
import { currentQueue, loadProposals, readImports, writeJson, writeQueue, type LoadedProposal, type ReviewEnv } from "./files";
import { REVIEW_VERSION, type ImportLogEntry } from "./queue";

type Outcome = {
  log: ImportLogEntry;
  /** Claims to store for the document, or null (stale or refused: runImport keeps no operator claims for it). */
  accepted: Claim[] | null;
};

export function importOne(input: {
  loaded: LoadedProposal;
  prepared: { ctx: VerifyContext } | null;
  officialDomains: string[];
  /** The LLM claims already stored for this document. */
  llmClaims: Claim[];
  now: string;
}): Outcome {
  const { loaded, prepared } = input;
  const base = { id: loaded.id, doc_key: loaded.run?.doc_key ?? "", proposals_sha256: loaded.file_sha256 };
  const rest = { proposed: 0, verified: 0, claim_ids: [] as string[], skipped_duplicates: [] as string[], dropped: [] as ImportLogEntry["dropped"] };
  const entry = (text_sha256: string | null, status: ImportLogEntry["status"], reason?: string, more: Partial<typeof rest> = {}): ImportLogEntry => ({
    ...base, text_sha256, imported_at: input.now, status, ...(reason ? { reason } : {}), ...rest, ...more,
  });

  const { result, record } = loaded;
  if (!result.ok) return { log: entry(result.text_sha256, "refused", result.reason), accepted: null };
  const { file } = result;
  if (!prepared || !record?.text) return { log: entry(file.text_sha256, "stale", "stored text does not match its hash or extractor"), accepted: null };
  if (record.text.sha256 !== file.text_sha256) return { log: entry(file.text_sha256, "stale", "the document text changed since the operator read it"), accepted: null };

  const built = buildClaims({
    record, docKey: file.doc_key, officialDomains: input.officialDomains, proposals: file.claims, verify: (c) => verifyClaim(c, prepared.ctx),
    model: file.proposed_by, promptVersion: REVIEW_VERSION, now: file.reviewed_at, fieldSource: "operator-reviewed",
  });
  const skipped_duplicates: string[] = [];
  const accepted = built.claims.filter((c) => {
    const twin = input.llmClaims.find((l) => l.asset === c.asset && l.field === c.field && l.value === c.value && l.as_of === c.as_of);
    if (twin) skipped_duplicates.push(twin.id);
    return !twin;
  });
  const dropped = built.dropped.map((d) => ({ field: d.field, asset_code: d.asset_code, reason: d.reason, value_text: d.value_text, quote: d.quote }));
  return {
    log: entry(file.text_sha256, "imported", undefined, { proposed: file.claims.length, verified: built.claims.length, claim_ids: accepted.map((c) => c.id), skipped_duplicates, dropped }),
    accepted,
  };
}

/** Keep the old imported_at when nothing else about the entry changed, so a re-run is byte-identical. */
export function keepTimestamp(next: ImportLogEntry, previous: ImportLogEntry | undefined) {
  if (!previous) return next;
  const same = { ...next, imported_at: previous.imported_at };
  return JSON.stringify(same) === JSON.stringify(previous) ? same : next;
}

/**
 * Storage is a pure function of the proposals files that are valid now: operator-reviewed
 * claims exist only for documents whose file imported in this run, and the import log lists
 * the current files only (entries for deleted files are pruned).
 */
export function runImport(env: ReviewEnv) {
  const { loaded, warnings } = loadProposals(env);
  const previous = new Map(readImports(env).map((e) => [e.id, e]));
  const log: ImportLogEntry[] = [];
  const live = new Set<string>();

  for (const l of loaded) {
    const record = l.record;
    const prepared = record && l.result.ok ? env.factory.contextFor(record) : null;
    const out = importOne({
      loaded: l, prepared, officialDomains: record ? env.factory.officialDomainsOf(record) : [],
      llmClaims: env.store.claims.filter((c) => c.doc_key === l.run?.doc_key && c.field_source === "llm"), now: env.now,
    });
    if (out.accepted) (env.store.recordReview(out.log.doc_key, out.accepted), live.add(out.log.doc_key));
    log.push(keepTimestamp(out.log, previous.get(out.log.id)));
  }

  const before = env.store.claims.length;
  env.store.retainReview(live);
  if (env.store.claims.length !== before || log.some((e) => e.status === "imported")) env.store.flush();
  const logFile = path.join(env.reviewDir, "imports.json");
  if (log.length > 0 || previous.size > 0) writeJson(logFile, log.sort((a, b) => a.id.localeCompare(b.id)));
  const { entries, skipped } = currentQueue(env, loaded, log);
  writeQueue(env, entries);
  return { outcomes: log, entries, skipped, warnings, refused: log.filter((o) => o.status === "refused").length };
}
