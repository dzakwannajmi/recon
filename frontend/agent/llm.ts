/**
 * THE MODEL LAYER
 *
 * Every LLM call goes through this file, so the provider can change by
 * config alone (decision D-017). Cost guards live here too (D-016):
 * a daily token budget counted per step, a step limit, an output-token cap,
 * and a timeout. The guard fails closed: if usage can't be read or saved,
 * no new calls start.
 *
 * Usage is counted per server and per provider (each free tier has its own
 * quota): `.cache/llm-usage.json` for google, `.cache/llm-usage-<provider>.json`
 * for the others (git-ignored).
 */
import fs from "fs";
import os from "os";
import path from "path";
import { generateText, isStepCount, jsonSchema, Output, tool, wrapLanguageModel, type LanguageModelUsage, type ModelMessage } from "ai";
import type { z } from "zod";
import { createGoogle } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { positiveInt } from "@/lib/env";
import { escapeInvisible } from "@/lib/gateway/text";
import type { Tool } from "./tools";

export const PROVIDER = process.env.LLM_PROVIDER || "google";
export const MODEL = process.env.LLM_MODEL || "gemini-flash-latest";
/** Batch extraction can use a different provider (the W2.6 benchmark compares google, groq, and openrouter). */
export const EXTRACT_PROVIDER = process.env.LLM_EXTRACT_PROVIDER || PROVIDER;
/**
 * The W2.6 benchmark pick for batch extraction (O-001, see internal/metrics.md): best precision and
 * recall of the four free-tier configs. Pinned to a version string, not a -latest alias, so the
 * measured model is the one that runs. Thinking level as benchmarked. The extraction cache key
 * holds provider and model only, so a change to the thinking level also needs a PROMPT_VERSION bump.
 */
const EXTRACT_PICK = { provider: "google", model: "gemini-3.7-flash", providerOptions: { google: { thinkingConfig: { thinkingLevel: "low" } } } };
/** LLM_EXTRACT_MODEL, else the benchmark pick on google, else the chat model. */
export const EXTRACT_MODEL = process.env.LLM_EXTRACT_MODEL || (EXTRACT_PROVIDER === EXTRACT_PICK.provider ? EXTRACT_PICK.model : MODEL);
/** The benchmarked provider options, only while the pinned model is the one in use. */
export const EXTRACT_PROVIDER_OPTIONS: ProviderOptions | undefined =
  EXTRACT_PROVIDER === EXTRACT_PICK.provider && EXTRACT_MODEL === EXTRACT_PICK.model ? EXTRACT_PICK.providerOptions : undefined;

const DAILY_TOKEN_BUDGET = positiveInt("LLM_DAILY_TOKEN_BUDGET", 200_000);
const MAX_OUTPUT_TOKENS = positiveInt("LLM_MAX_OUTPUT_TOKENS", 1024);
const MAX_STEPS = 5;
const TIMEOUT_MS = 60_000;
// Vercel functions can only write to the temp dir, so there the budget is counted per instance.
const USAGE_DIR = () => (process.env.VERCEL ? os.tmpdir() : path.join(process.cwd(), ".cache"));

export type Step = { tool: string; args: unknown; result: unknown; error?: boolean };

/** The daily budget is used up. Its message is safe to show. */
export class BudgetExceededError extends Error {}

/** The words shown when a provider's request limit (per day or per minute) is reached. */
export const REQUEST_LIMIT_MESSAGE = "This model's request limit is reached. Pick another model or try later.";

/** A provider's request limit (per day or per minute) is reached; no provider call was made. Its message is safe to show. */
export class RequestLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super(REQUEST_LIMIT_MESSAGE);
    this.name = "RequestLimitError";
  }
}

/**
 * Batch extraction on another provider than chat needs its own model: the chat default is a
 * model name for the chat provider and must never go to a different vendor.
 */
export function assertExtractConfig() {
  if (EXTRACT_PROVIDER !== PROVIDER && !process.env.LLM_EXTRACT_MODEL) {
    throw new Error(`LLM_EXTRACT_PROVIDER is "${EXTRACT_PROVIDER}", which differs from LLM_PROVIDER, so LLM_EXTRACT_MODEL must be set.`);
  }
}

/** Where each provider's key lives. The values are env var names, never keys. */
const KEY_ENV: Record<string, string> = { google: "GEMINI_API_KEY", groq: "GROQ_API_KEY", openrouter: "OPENROUTER_API_KEY" };

/** The env var that holds a provider's API key (the name only, never a value); null for an unknown provider. */
export function apiKeyEnvName(provider: string) {
  return KEY_ENV[provider] ?? null;
}

function keyEnv(provider: string) {
  const name = KEY_ENV[provider];
  if (!name) throw new Error(`LLM provider "${provider}" is not set up. Use one of: ${Object.keys(KEY_ENV).join(", ")}.`);
  return name;
}

export function hasApiKey(provider = PROVIDER) {
  const name = KEY_ENV[provider];
  return Boolean(name && process.env[name]);
}

export function languageModel(provider: string, model: string) {
  const name = keyEnv(provider);
  const apiKey = process.env[name];
  if (!apiKey) throw new Error(`${name} is not set (put it in frontend/.env).`);
  if (provider === "google") return createGoogle({ apiKey })(model);
  if (provider === "groq") return createGroq({ apiKey })(model);
  return createOpenAICompatible({ name: "openrouter", baseURL: "https://openrouter.ai/api/v1", apiKey, supportsStructuredOutputs: true })(model);
}

/** google keeps its original file name so today's count survives; the others get their own. */
export function usageFile(provider: string) {
  keyEnv(provider);
  return path.join(USAGE_DIR(), provider === "google" ? "llm-usage.json" : `llm-usage-${provider}.json`);
}

type Usage = { day: string; tokens: number };

const usageUnavailable = new Set<string>();

function today() {
  return new Date().toISOString().slice(0, 10);
}

function readUsage(provider: string): Usage {
  try {
    const usage = JSON.parse(fs.readFileSync(usageFile(provider), "utf8")) as Usage;
    return usage.day === today() ? usage : { day: today(), tokens: 0 };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { day: today(), tokens: 0 };
    usageUnavailable.add(provider);
    return { day: today(), tokens: DAILY_TOKEN_BUDGET };
  }
}

function recordUsage(provider: string, usage: LanguageModelUsage) {
  const tokens = usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
  if (!tokens) {
    // A successful call that reports no usage cannot be counted: fail closed for this provider.
    usageUnavailable.add(provider);
    console.error(`LLM usage was not reported by provider "${provider}"; its calls are blocked until the server restarts.`);
    return;
  }
  try {
    const file = usageFile(provider);
    const current = readUsage(provider);
    current.tokens += tokens;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(current));
    fs.renameSync(tmp, file);
  } catch (err) {
    usageUnavailable.add(provider);
    console.error("LLM usage could not be saved:", (err as Error).name);
  }
}

/** Tokens left today for one provider's quota (fail closed: 0 if its usage file cannot be read or written). */
export function budgetLeft(provider = PROVIDER) {
  if (usageUnavailable.has(provider)) return 0;
  return Math.max(0, DAILY_TOKEN_BUDGET - readUsage(provider).tokens);
}

/**
 * The RequestLimitError inside an error, if any. The AI SDK wraps what a retried call throws (AI_RetryError.lastError,
 * `errors`, or a cause), so the limit may sit one or two levels down.
 */
export function findRequestLimit(err: unknown): RequestLimitError | null {
  const seen = new Set<unknown>();
  const walk = (e: unknown, depth: number): RequestLimitError | null => {
    if (e instanceof RequestLimitError) return e;
    if (!(e instanceof Error) || seen.has(e) || depth > 5) return null;
    seen.add(e);
    const w = e as Error & { lastError?: unknown; errors?: unknown; cause?: unknown };
    const next = [w.lastError, w.cause, ...(Array.isArray(w.errors) ? w.errors : [])];
    for (const n of next) {
      const hit = walk(n, depth + 1);
      if (hit) return hit;
    }
    return null;
  };
  return walk(err, 0);
}

// ---------------------------------------------------------------- provider requests (chat only)

/**
 * Free tiers limit REQUESTS, not just tokens (Gemini's free key: 5 per minute, 20 per day), and every tool step and
 * every SDK retry is one request. So the chat counts requests per provider, per UTC day and per rolling minute, in
 * its own file next to the token count, and refuses before a call that would go over. Same fail-closed rule: if the
 * count cannot be read or saved, no call starts. Extraction runs from operator scripts, not from the page, and is
 * left out. LLM_DAILY_REQUEST_BUDGET and LLM_MINUTE_REQUEST_BUDGET, when set, apply to every provider; when unset,
 * google gets the conservative defaults below and the others have no request limit.
 */
const GOOGLE_DAILY_REQUESTS = 18;
const GOOGLE_MINUTE_REQUESTS = 4;
const MINUTE_MS = 60_000;

/** The request limits of a provider; null means no limit. Read from the environment at call time. */
export function requestLimits(provider: string): { day: number | null; minute: number | null } {
  const google = provider === "google";
  const day = (process.env.LLM_DAILY_REQUEST_BUDGET ?? "").trim() !== "" ? positiveInt("LLM_DAILY_REQUEST_BUDGET", google ? GOOGLE_DAILY_REQUESTS : 0) : google ? GOOGLE_DAILY_REQUESTS : 0;
  const minute = (process.env.LLM_MINUTE_REQUEST_BUDGET ?? "").trim() !== "" ? positiveInt("LLM_MINUTE_REQUEST_BUDGET", google ? GOOGLE_MINUTE_REQUESTS : 0) : google ? GOOGLE_MINUTE_REQUESTS : 0;
  return { day: day > 0 ? day : null, minute: minute > 0 ? minute : null };
}

type RequestCount = { day: string; count: number; /** Start times (ms) of the requests in the last minute. */ recent: number[] };

const requestsUnavailable = new Set<string>();

function requestFile(provider: string) {
  keyEnv(provider);
  return path.join(USAGE_DIR(), provider === "google" ? "llm-requests.json" : `llm-requests-${provider}.json`);
}

/** The count for today and the last minute. Throws when the file exists but cannot be read (the caller fails closed). */
function readRequests(provider: string, now: number): RequestCount {
  const fresh: RequestCount = { day: today(), count: 0, recent: [] };
  let raw: string;
  try {
    raw = fs.readFileSync(requestFile(provider), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return fresh;
    throw err;
  }
  const saved = JSON.parse(raw) as RequestCount;
  if (typeof saved.day !== "string" || !Number.isInteger(saved.count) || !Array.isArray(saved.recent)) throw new Error("bad request count");
  const recent = saved.recent.filter((t) => Number.isFinite(t) && t <= now && now - t < MINUTE_MS);
  return saved.day === fresh.day ? { day: saved.day, count: saved.count, recent } : { ...fresh, recent };
}

/** Seconds until the limit that is hit frees up: the oldest request leaves the minute, or the UTC day ends. At least 1. */
function retryAfter(c: RequestCount, limits: ReturnType<typeof requestLimits>, now: number) {
  const dayHit = limits.day !== null && c.count >= limits.day;
  if (dayHit) return Math.max(1, Math.ceil((Date.parse(`${today()}T00:00:00Z`) + 86_400_000 - now) / 1000));
  return Math.max(1, Math.ceil(((c.recent[0] ?? now) + MINUTE_MS - now) / 1000));
}

/**
 * Takes one request from the provider's day and minute allowance, or throws RequestLimitError. With `reserve: false`
 * it only checks. Synchronous from read to write, so concurrent requests in one server cannot both take the last one.
 */
export function takeRequest(provider: string, opts: { reserve?: boolean; now?: number } = {}) {
  const limits = requestLimits(provider);
  if (limits.day === null && limits.minute === null) return;
  const now = opts.now ?? Date.now();
  if (requestsUnavailable.has(provider)) throw new RequestLimitError(60);
  let c: RequestCount;
  try {
    c = readRequests(provider, now);
  } catch {
    requestsUnavailable.add(provider);
    console.error(`LLM request count could not be read for provider "${provider}"; its chat calls are blocked until the server restarts.`);
    throw new RequestLimitError(60);
  }
  if ((limits.day !== null && c.count >= limits.day) || (limits.minute !== null && c.recent.length >= limits.minute)) {
    throw new RequestLimitError(retryAfter(c, limits, now));
  }
  if (opts.reserve === false) return;
  c.count += 1;
  c.recent.push(now);
  try {
    const file = requestFile(provider);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(c));
    fs.renameSync(tmp, file);
  } catch (err) {
    requestsUnavailable.add(provider);
    console.error("LLM request count could not be saved:", (err as Error).name);
    throw new RequestLimitError(60);
  }
}

/** Wraps a model so that every request it sends to the provider (each step, each retry) is counted first. */
export function withRequestCount<M extends Parameters<typeof wrapLanguageModel>[0]["model"]>(model: M, provider: string) {
  return wrapLanguageModel({
    model,
    middleware: {
      wrapGenerate: async ({ doGenerate }) => {
        takeRequest(provider);
        return doGenerate();
      },
      wrapStream: async ({ doStream }) => {
        takeRequest(provider);
        return doStream();
      },
    },
  });
}

/** Run the model with tools for up to MAX_STEPS steps and return the answer plus every tool call. */
export async function generateWithTools(opts: {
  instructions: string;
  messages: ModelMessage[];
  tools: Tool[];
  /** A validated allowlist entry (agent/models.ts). Defaults to the env chat model. */
  chat?: { provider: string; model: string };
}) {
  const provider = opts.chat?.provider ?? PROVIDER;
  const modelName = opts.chat?.model ?? MODEL;
  if (budgetLeft(provider) <= 0) throw new BudgetExceededError("Today's LLM budget is used up. Try again tomorrow.");
  // Refuse before any provider call when the request allowance is gone (each model step then takes one more).
  takeRequest(provider, { reserve: false });

  const steps: Step[] = [];
  const controller = new AbortController();
  let budgetRanOut = false;

  const modelTools = Object.fromEntries(
    opts.tools.map((t) => [
      t.name,
      tool({
        description: t.description,
        inputSchema: jsonSchema(t.parameters as Parameters<typeof jsonSchema>[0]),
        execute: (args, { abortSignal }) => t.run(args, { abortSignal }),
      }),
    ]),
  );

  try {
    const result = await generateText({
      model: withRequestCount(languageModel(provider, modelName), provider),
      instructions: opts.instructions,
      messages: opts.messages,
      tools: modelTools,
      stopWhen: isStepCount(MAX_STEPS),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      timeout: { totalMs: TIMEOUT_MS },
      abortSignal: controller.signal,
      onStepEnd: ({ usage, finishReason }) => {
        recordUsage(provider, usage);
        // Stop before the next step if this one used up the budget.
        if (finishReason === "tool-calls" && budgetLeft(provider) <= 0) {
          budgetRanOut = true;
          controller.abort();
        }
      },
      onToolExecutionEnd: ({ toolCall, toolOutput }) => {
        steps.push(
          toolOutput.type === "tool-error"
            ? { tool: toolCall.toolName, args: toolCall.input, result: { error: escapeInvisible(String(toolOutput.error)) }, error: true }
            : { tool: toolCall.toolName, args: toolCall.input, result: toolOutput.output },
        );
      },
    });
    return { text: result.text, steps };
  } catch (err) {
    if (budgetRanOut) throw new BudgetExceededError("Today's LLM budget ran out during this answer. Try again tomorrow.");
    throw err;
  }
}

/** Provider-specific settings passed straight to the AI SDK (e.g. `{ google: { thinkingConfig: { thinkingLevel: "low" } } }`). */
export type ProviderOptions = NonNullable<Parameters<typeof generateText>[0]["providerOptions"]>;

/** Token usage of one call. `reasoning` is the part of `output` the model spent thinking; null if the provider does not report it. */
export type TokenUsage = { input: number; output: number; reasoning: number | null; total: number };

/**
 * One structured-output call with no tools, for quarantined extraction from
 * untrusted documents. It counts against the same daily budget and fails
 * closed the same way. Returns the parsed output, the tokens used, the
 * usage split (input, output, reasoning, total), and the response model ID.
 */
export async function generateStructured<T>(opts: {
  instructions: string;
  prompt: string;
  schema: z.ZodType<T>;
  maxOutputTokens?: number;
  model?: string;
  /** Defaults to EXTRACT_PROVIDER. Another provider needs an explicit `model`. */
  provider?: string;
  providerOptions?: ProviderOptions;
  /** SDK retries on 429/5xx (default 2). The benchmark passes 0 and retries itself, so free-tier requests are not burned in bursts. */
  maxRetries?: number;
}) {
  const provider = opts.provider ?? EXTRACT_PROVIDER;
  if (provider !== EXTRACT_PROVIDER && !opts.model) throw new Error(`A model is required for provider "${provider}".`);
  if (!opts.model) assertExtractConfig();
  if (budgetLeft(provider) <= 0) throw new BudgetExceededError("Today's LLM budget is used up. Try again tomorrow.");
  const result = await generateText({
    model: languageModel(provider, opts.model ?? EXTRACT_MODEL),
    instructions: opts.instructions,
    prompt: opts.prompt,
    output: Output.object({ schema: opts.schema }),
    maxOutputTokens: opts.maxOutputTokens ?? 4096,
    ...(opts.providerOptions ? { providerOptions: opts.providerOptions } : {}),
    ...(opts.maxRetries !== undefined ? { maxRetries: opts.maxRetries } : {}),
    timeout: { totalMs: 120_000 },
    onStepEnd: ({ usage }) => recordUsage(provider, usage),
  });
  const u = result.totalUsage;
  const input = u.inputTokens ?? 0;
  const output = u.outputTokens ?? 0;
  const total = u.totalTokens ?? input + output;
  return {
    output: result.output as T,
    tokens: total,
    usage: { input, output, reasoning: u.outputTokenDetails?.reasoningTokens ?? null, total } satisfies TokenUsage,
    /** The model ID the provider says answered (may differ from the requested alias). */
    responseModel: (result.response?.modelId as string | undefined) ?? null,
  };
}
