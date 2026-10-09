import { describe, expect, it } from "vitest";
import { BudgetExceededError } from "../../agent/llm";
import { CONFIGS, type BenchConfig } from "./configs";
import type { BenchDoc } from "./docs";
import { estimateTokens, isTransient, runBenchmark, runKey, type Generate, type RunRecord } from "./run";

const config: BenchConfig = { name: "flash", provider: "google", model: "gemini-x", providerOptions: { google: { thinkingConfig: { thinkingLevel: "low" } } } };

const doc = (id: string, chars = 3500, chunks = 1): BenchDoc =>
  ({
    id, doc_key: `${id}|A:1`, url: `https://example.com/${id}`, kind: "html", assets: [{ code: "AAA", name: "Alpha" }], snapshot_sha256: "s", text_sha256: `t-${id}`,
    chunks: Array.from({ length: chunks }, (_, i) => ({ label: `part ${i + 1}`, text: "x", score: 1, order: i })), total_chunks: 3, window_chars: chars, full_chars: chars,
  }) as unknown as BenchDoc;

const usage = { input: 100, output: 20, reasoning: 5, total: 120 };
const ok: Generate = async () => ({ output: { claims: [] }, usage });

/** A fake world: a clock that sleep() advances and a generate() that takes 100 ms. */
function world(generate: Generate) {
  let t = 1_000_000;
  const sleeps: number[] = [];
  const saves: RunRecord[][] = [];
  const calls: number[] = [];
  const opts = (extra: Partial<Parameters<typeof runBenchmark>[0]> & { docs: BenchDoc[]; runs?: RunRecord[] }) => ({
    config, runs: [], save: (r: RunRecord[]) => void saves.push(r), budgetLeft: () => 1_000_000, appReserve: 50_000, outputTokens: 4096, minGapMs: 6000, retryWaitMs: 30_000,
    generate: async (input: Parameters<Generate>[0]) => {
      calls.push(t);
      t += 100;
      return generate(input);
    },
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
    },
    clock: () => t, now: () => "2026-10-08T00:00:00.000Z", ...extra,
  });
  return { opts, sleeps, saves, calls };
}

describe("runKey", () => {
  const d = doc("a");
  it("keeps the keys of the google configs as they were before providers existed (stored runs must not re-run)", () => {
    // Computed with the key function before `provider` and `maxOutputTokens` were added.
    const fixture = { doc_key: "https://example.com/doc|A:1", assets: [{ code: "AAA", name: "Alpha" }] };
    const key = (name: string) => runKey(CONFIGS.find((c) => c.name === name)!, fixture);
    expect(key("flash-lite")).toBe("9d0361f24f21b3e419ca14468755106e");
    expect(key("flash")).toBe("09a4d88f4ec7e74a9423e411f78d78ee");
  });
  it("changes with a non-google provider and with a set output cap, not with an absent one", () => {
    const base = runKey(config, d);
    expect(runKey({ ...config, provider: "groq" }, d)).not.toBe(base);
    expect(runKey({ ...config, provider: "groq" }, d)).not.toBe(runKey({ ...config, provider: "openrouter" }, d));
    expect(runKey({ ...config, maxOutputTokens: 2048 }, d)).not.toBe(base);
    expect(runKey({ ...config, maxOutputTokens: undefined }, d)).toBe(base);
  });
  it("is stable and 32 hex characters", () => {
    expect(runKey(config, d)).toBe(runKey({ ...config }, doc("a")));
    expect(runKey(config, d)).toMatch(/^[0-9a-f]{32}$/);
  });
  it("changes with the model, the provider options, the document, and the assets", () => {
    const base = runKey(config, d);
    expect(runKey({ ...config, model: "gemini-y" }, d)).not.toBe(base);
    expect(runKey({ ...config, providerOptions: { google: { thinkingConfig: { thinkingLevel: "minimal" } } } }, d)).not.toBe(base);
    expect(runKey({ ...config, name: "other" }, d)).not.toBe(base);
    expect(runKey(config, doc("b"))).not.toBe(base);
    expect(runKey(config, { ...d, assets: [{ code: "BBB" }] })).not.toBe(base);
  });
});

describe("isTransient", () => {
  it("retries rate limits, overload, and timeouts but not budget or other errors", () => {
    expect(isTransient(Object.assign(new Error("x"), { statusCode: 429 }))).toBe(true);
    expect(isTransient(new Error("503 Service Unavailable"))).toBe(true);
    expect(isTransient(new Error("The operation timed out"))).toBe(true);
    expect(isTransient(new Error("Invalid JSON response"))).toBe(false);
    expect(isTransient(Object.assign(new Error("x"), { statusCode: 503 }))).toBe(true);
    expect(isTransient(new BudgetExceededError("Today's LLM budget is used up. Try again tomorrow."))).toBe(false);
  });
});

describe("isTransient, not retryable statuses", () => {
  it("does not retry 413 (request over the per-minute token cap, even when Groq words it as a rate limit) or 402", () => {
    const tooBig = Object.assign(new Error("Request too large for model: rate_limit_exceeded, tokens per minute (TPM)"), { statusCode: 413, data: { error: { code: "rate_limit_exceeded" } } });
    expect(isTransient(tooBig)).toBe(false);
    expect(isTransient(Object.assign(new Error("Insufficient credits"), { statusCode: 402 }))).toBe(false);
    expect(isTransient(Object.assign(new Error("rate limit"), { statusCode: 429 }))).toBe(true); // a real rate limit still retries
  });
});

describe("runBenchmark", () => {
  it("runs each document, saves after every one, and waits at least the gap between calls", async () => {
    const w = world(ok);
    const summary = await runBenchmark(w.opts({ docs: [doc("a"), doc("b"), doc("c")] }));
    expect(summary).toMatchObject({ ran: 3, skipped: 0, failed: 0, stoppedForBudget: false });
    expect(w.saves.map((s) => s.length)).toEqual([1, 2, 3]);
    expect(w.sleeps).toEqual([6000, 6000]); // gap counted from the end of the previous call
    const last = w.saves[2];
    expect(last[0]).toMatchObject({ config: "flash", provider: "google", doc_id: "a", model: "gemini-x", attempts: 1, error: null, usage, latency_ms: 100, chunks_sent: 1, chars_sent: 3500 });
    expect(last[0].key).toBe(runKey(config, doc("a")));
  });

  it("skips successful runs, retries failed ones, and --force redoes everything", async () => {
    const first = world(async () => {
      throw new Error("Invalid JSON response");
    });
    await runBenchmark(first.opts({ docs: [doc("a")] }));
    const failedRuns = first.saves.at(-1)!;
    expect(failedRuns[0]).toMatchObject({ error: "Error", attempts: 1, usage: null });

    const second = world(ok);
    const s2 = await runBenchmark(second.opts({ docs: [doc("a")], runs: failedRuns }));
    expect(s2.ran).toBe(1);
    const doneRuns = second.saves.at(-1)!;
    expect(doneRuns).toHaveLength(1);
    expect(doneRuns[0].error).toBeNull();

    const third = world(ok);
    const s3 = await runBenchmark(third.opts({ docs: [doc("a")], runs: doneRuns }));
    expect(s3).toMatchObject({ ran: 0, skipped: 1 });
    expect(third.calls).toHaveLength(0);

    const fourth = world(ok);
    expect((await runBenchmark(fourth.opts({ docs: [doc("a")], runs: doneRuns, force: true }))).ran).toBe(1);

    // A changed config (new key) is not a cache hit.
    const fifth = world(ok);
    const changed = { ...config, model: "gemini-y" };
    expect((await runBenchmark(fifth.opts({ docs: [doc("a")], runs: doneRuns, config: changed }))).ran).toBe(1);
  });

  it("waits 30 s and retries once on a transient error, recording attempts", async () => {
    let n = 0;
    const w = world(async (input) => {
      if (++n === 1) throw Object.assign(new Error("Too many requests"), { statusCode: 429 });
      return ok(input);
    });
    const summary = await runBenchmark(w.opts({ docs: [doc("a")] }));
    expect(w.sleeps).toEqual([30_000]);
    expect(summary.failed).toBe(0);
    expect(w.saves[0][0]).toMatchObject({ attempts: 2, error: null });
  });

  it("gives up after one retry and records the error", async () => {
    const w = world(async () => {
      throw Object.assign(new Error("503 Service Unavailable"), { statusCode: 503 });
    });
    const summary = await runBenchmark(w.opts({ docs: [doc("a")] }));
    expect(summary.failed).toBe(1);
    expect(w.calls).toHaveLength(2);
    expect(w.saves[0][0]).toMatchObject({ attempts: 2, error: "Error HTTP 503" });
  });

  it("records the provider, and does not retry a 413 or 402: one call, error kept", async () => {
    const groq: BenchConfig = { ...config, name: "g", provider: "groq" };
    for (const [statusCode, text] of [[413, "Error HTTP 413 rate_limit_exceeded"], [402, "Error HTTP 402"]] as const) {
      const w = world(async () => {
        throw Object.assign(new Error("Request too large: rate_limit_exceeded"), { statusCode, ...(statusCode === 413 ? { data: { error: { code: "rate_limit_exceeded" } } } : {}) });
      });
      const summary = await runBenchmark(w.opts({ config: groq, docs: [doc("a")] }));
      expect(w.calls).toHaveLength(1);
      expect(w.sleeps).toEqual([]);
      expect(summary.failed).toBe(1);
      expect(w.saves[0][0]).toMatchObject({ provider: "groq", attempts: 1, error: text });
    }
  });

  it("does not retry a non-transient error", async () => {
    const w = world(async () => {
      throw new Error("Invalid JSON response");
    });
    await runBenchmark(w.opts({ docs: [doc("a")] }));
    expect(w.calls).toHaveLength(1);
    expect(w.saves[0][0].attempts).toBe(1);
  });

  it("stops, keeping finished runs, when the budget minus the app reserve cannot cover the next document", async () => {
    const need = estimateTokens(doc("a"), 4096);
    let left = 50_000 + need + 10;
    const w = world(async (input) => {
      left -= 5000;
      return ok(input);
    });
    const summary = await runBenchmark(w.opts({ docs: [doc("a"), doc("b")], budgetLeft: () => left }));
    expect(summary).toMatchObject({ ran: 1, stoppedForBudget: true });
    expect(w.saves.at(-1)).toHaveLength(1);
  });

  it("dry run calls nothing and saves nothing but adds up the estimate", async () => {
    const w = world(ok);
    const docs = [doc("a", 3500), doc("b", 7000)];
    const summary = await runBenchmark(w.opts({ docs, dryRun: true }));
    expect(w.calls).toHaveLength(0);
    expect(w.saves).toHaveLength(0);
    expect(summary.estimatedTokens).toBe(estimateTokens(docs[0], 4096) + estimateTokens(docs[1], 4096));
  });

  it("honors the limit and makes no call for a document with no chunks", async () => {
    const w = world(ok);
    const summary = await runBenchmark(w.opts({ docs: [doc("a", 10, 0), doc("b"), doc("c")], limit: 2 }));
    expect(summary.ran).toBe(2);
    expect(w.calls).toHaveLength(1);
    expect(w.saves.at(-1)![0]).toMatchObject({ doc_id: "a", attempts: 0, usage: null, error: null });
  });

  it("checks the stop rule again before the retry", async () => {
    const need = estimateTokens(doc("a"), 4096);
    let left = 50_000 + need + 10;
    const w = world(async () => {
      left = 0; // the first attempt used the rest of the budget
      throw Object.assign(new Error("x"), { statusCode: 429 });
    });
    const summary = await runBenchmark(w.opts({ docs: [doc("a")], budgetLeft: () => left }));
    expect(w.calls).toHaveLength(1);
    expect(summary.stoppedForBudget).toBe(true);
    expect(w.saves[0][0]).toMatchObject({ attempts: 1, error: "Error HTTP 429" });
  });

  it("keeps an earlier good run when a forced re-run fails, and records the response model otherwise", async () => {
    const good = world(async (input) => ({ ...(await ok(input)), responseModel: "gemini-x-001" }));
    await runBenchmark(good.opts({ docs: [doc("a")] }));
    const goodRuns = good.saves.at(-1)!;
    expect(goodRuns[0].response_model).toBe("gemini-x-001");

    const bad = world(async () => {
      throw new Error("Invalid JSON response");
    });
    const logs: string[] = [];
    const summary = await runBenchmark(bad.opts({ docs: [doc("a")], runs: goodRuns, force: true, log: (l: string) => void logs.push(l) }));
    expect(summary.failed).toBe(1);
    expect(bad.saves).toHaveLength(0); // nothing overwritten
    expect(logs.some((l) => l.includes("keeping the earlier successful run"))).toBe(true);
  });
});
