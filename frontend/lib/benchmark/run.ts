/**
 * The benchmark runner core. The model call is injected (`generate`), as are
 * the clock, the sleep, and the file write, so tests run with no network.
 * One run record per document and config, written atomically after every
 * document to data/benchmark/runs/<config>.json.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { z } from "zod";
import { BudgetExceededError, type TokenUsage } from "../../agent/llm";
import { describeError } from "../llm-errors";
import { CLAIM_FIELDS, extractionSchema, type ProposedClaim } from "../claims/fields";
import { EXTRACTION_INSTRUCTIONS, PROMPT_VERSION, buildPrompt } from "../claims/prompt";
import { MAX_CHARS_PER_DOCUMENT } from "../claims/select";
import type { BenchConfig } from "./configs";
import type { BenchDoc } from "./docs";

export const BENCH_DIR = process.env.BENCHMARK_DIR || path.join(process.cwd(), "..", "data", "benchmark");

export type RunRecord = {
  key: string;
  config: string;
  /** Absent in records written before other providers were added: those are google runs. */
  provider?: string;
  doc_id: string;
  doc_key: string;
  source_url: string;
  text_sha256: string;
  model: string;
  provider_options: unknown;
  /** The model ID the provider reported answering (absent in records written before it was captured; not part of the key). */
  response_model?: string | null;
  prompt_version: string;
  chunks_sent: number;
  chars_sent: number;
  proposals: ProposedClaim[];
  /** Null when no call was made or the call failed. */
  usage: TokenUsage | null;
  /** Wall time of the last attempt (the one that succeeded or finally failed), without the wait between attempts. */
  latency_ms: number | null;
  attempts: number;
  error: string | null;
  at: string;
};

export type Generate = (input: {
  instructions: string;
  prompt: string;
  schema: z.ZodType<{ claims: unknown[] }>;
}) => Promise<{ output: { claims: unknown[] }; usage: TokenUsage; responseModel?: string | null }>;

/**
 * Everything that changes what the model sees or how it is set up, so a changed config never reuses an old run.
 * `provider` (when not google) and `maxOutputTokens` (when set) are appended only then, so the keys of the
 * original google configs stay what they were and their stored runs are not redone.
 */
export function runKey(config: BenchConfig, doc: Pick<BenchDoc, "doc_key" | "assets">) {
  const parts: unknown[] = [
    config.name, config.model, config.providerOptions, PROMPT_VERSION, EXTRACTION_INSTRUCTIONS, Object.keys(CLAIM_FIELDS), MAX_CHARS_PER_DOCUMENT, doc.doc_key, doc.assets,
  ];
  if (config.provider !== "google") parts.push({ provider: config.provider });
  if (config.maxOutputTokens !== undefined) parts.push({ maxOutputTokens: config.maxOutputTokens });
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
}

/**
 * Rate limit, overload, or timeout: worth one retry after a wait. Not 413 (one request larger than the
 * tokens-per-minute cap: Groq sends it with code `rate_limit_exceeded`, so the status is checked before
 * the text) and not 402 (no credit): waiting does not help.
 */
export function isTransient(err: unknown) {
  if (err instanceof BudgetExceededError) return false;
  const status = (err as { statusCode?: number } | null)?.statusCode;
  if (status === 413 || status === 402) return false;
  if (status === 429 || status === 503) return true;
  const text = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  return /\b(429|503)\b|rate.?limit|quota|resource.?exhausted|unavailable|overloaded|time.?out|timed out|abort/i.test(text);
}

export const estimateTokens = (doc: BenchDoc, outputTokens: number) => Math.ceil((doc.window_chars + EXTRACTION_INSTRUCTIONS.length) / 3.5) + outputTokens;

export function readRuns(file: string): RunRecord[] {
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as RunRecord[]) : [];
}

export function writeRuns(file: string, runs: RunRecord[]) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(runs, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

export type RunOptions = {
  config: BenchConfig;
  docs: BenchDoc[];
  runs: RunRecord[];
  generate: Generate;
  save: (runs: RunRecord[]) => void;
  budgetLeft: () => number;
  appReserve: number;
  outputTokens: number;
  minGapMs: number;
  retryWaitMs: number;
  force?: boolean;
  limit?: number;
  dryRun?: boolean;
  log?: (line: string) => void;
  sleep?: (ms: number) => Promise<void>;
  /** Milliseconds clock for latency and for spacing calls. */
  clock?: () => number;
  now?: () => string;
};

/**
 * Run (or skip) each document in order. A document is skipped when a run with the
 * same key exists and did not fail, unless `force`. Failed runs are retried
 * on the next invocation. Stops, saving what is done, when the daily budget
 * (minus the app reserve) cannot cover the next document.
 */
export async function runBenchmark(opts: RunOptions) {
  const { config, docs, generate, save, budgetLeft, outputTokens } = opts;
  const log = opts.log ?? (() => {});
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const clock = opts.clock ?? (() => performance.now());
  const now = opts.now ?? (() => new Date().toISOString());
  const limit = opts.limit ?? Infinity;

  let runs = [...opts.runs];
  const summary = { ran: 0, skipped: 0, failed: 0, stoppedForBudget: false, estimatedTokens: 0 };
  let lastCallEnd: number | null = null;

  for (const doc of docs) {
    if (summary.ran >= limit) break;
    const key = runKey(config, doc);
    const earlier = runs.find((r) => r.doc_id === doc.id);
    if (!opts.force && earlier && earlier.key === key && earlier.error === null) {
      summary.skipped++;
      continue;
    }
    const estimate = doc.chunks.length > 0 ? estimateTokens(doc, outputTokens) : 0;
    log(`${doc.url}\n    ${doc.kind}, ${doc.chunks.length}/${doc.total_chunks} chunks, ${doc.window_chars} chars, ~${estimate} tokens max${earlier?.error ? " (retrying after an error)" : ""}`);
    summary.estimatedTokens += estimate;
    summary.ran++;
    if (opts.dryRun) continue;

    const record: RunRecord = {
      key, config: config.name, provider: config.provider, doc_id: doc.id, doc_key: doc.doc_key, source_url: doc.url, text_sha256: doc.text_sha256, model: config.model,
      provider_options: config.providerOptions, prompt_version: PROMPT_VERSION, chunks_sent: doc.chunks.length, chars_sent: doc.window_chars,
      proposals: [], usage: null, latency_ms: null, attempts: 0, error: null, at: now(),
    };

    if (doc.chunks.length > 0) {
      if (budgetLeft() - opts.appReserve < estimate) {
        log(`    stopping: ${budgetLeft()} tokens left today and ${opts.appReserve} are kept for the app; this document may need ${estimate}`);
        summary.ran--;
        summary.stoppedForBudget = true;
        break;
      }
      const input = {
        instructions: EXTRACTION_INSTRUCTIONS,
        prompt: buildPrompt({ url: doc.url, kind: doc.kind, assets: doc.assets, chunks: doc.chunks }),
        schema: extractionSchema(doc.assets.map((a) => a.code) as [string, ...string[]]) as unknown as z.ZodType<{ claims: unknown[] }>,
      };
      for (let attempt = 1; attempt <= 2; attempt++) {
        // The retry spends tokens too: check the stop rule again.
        if (attempt > 1 && budgetLeft() - opts.appReserve < estimate) {
          log(`    not retrying: ${budgetLeft()} tokens left today and ${opts.appReserve} are kept for the app`);
          summary.stoppedForBudget = true;
          break;
        }
        // Free-tier requests per minute: keep a gap between calls.
        if (lastCallEnd !== null) {
          const wait = opts.minGapMs - (clock() - lastCallEnd);
          if (wait > 0) await sleep(wait);
        }
        record.attempts = attempt;
        const started = clock();
        try {
          const result = await generate(input);
          record.latency_ms = Math.round(clock() - started);
          record.proposals = result.output.claims as ProposedClaim[];
          record.usage = result.usage;
          record.response_model = result.responseModel ?? null;
          record.error = null;
          lastCallEnd = clock();
          break;
        } catch (err) {
          record.latency_ms = Math.round(clock() - started);
          record.error = describeError(err);
          lastCallEnd = clock();
          if (err instanceof BudgetExceededError) {
            summary.stoppedForBudget = true;
            break;
          }
          if (attempt === 1 && isTransient(err)) {
            log(`    transient error (${record.error}); waiting ${Math.round(opts.retryWaitMs / 1000)} s and retrying once`);
            await sleep(opts.retryWaitMs);
            lastCallEnd = null;
            continue;
          }
          break;
        }
      }
    }

    // A failed re-run (e.g. --force) never replaces an earlier good run with the same key.
    if (record.error && earlier && earlier.key === key && earlier.error === null) {
      log(`    warning: this attempt failed (${record.error}); keeping the earlier successful run`);
      summary.failed++;
      if (summary.stoppedForBudget) break;
      continue;
    }

    runs = [...runs.filter((r) => r.doc_id !== doc.id), record].sort((a, b) => a.doc_id.localeCompare(b.doc_id));
    save(runs);
    if (record.error) {
      summary.failed++;
      log(`    error after ${record.attempts} attempt(s): ${record.error}`);
    } else {
      log(`    ${record.proposals.length} proposed, ${record.usage ? `${record.usage.total} tokens (${record.usage.reasoning ?? "?"} reasoning), ` : ""}${record.latency_ms ?? 0} ms`);
    }
    if (summary.stoppedForBudget) break;
  }
  return summary;
}
