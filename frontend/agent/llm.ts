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
import { generateText, isStepCount, jsonSchema, Output, tool, type LanguageModelUsage, type ModelMessage } from "ai";
import type { z } from "zod";
import { createGoogle } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { positiveInt } from "@/lib/env";
import type { Tool } from "./tools";

export const PROVIDER = process.env.LLM_PROVIDER || "google";
export const MODEL = process.env.LLM_MODEL || "gemini-flash-latest";
/** Batch extraction can use a different provider (the W2.6 benchmark compares google, groq, and openrouter). */
export const EXTRACT_PROVIDER = process.env.LLM_EXTRACT_PROVIDER || PROVIDER;
/**
 * The W2.6 benchmark pick for batch extraction (O-001, see internal/metrics.md): best precision and
 * recall of the four free-tier configs. Pinned to a version string, not a -latest alias, so the
 * measured model is the one that runs. Thinking level as benchmarked.
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

/** Run the model with tools for up to MAX_STEPS steps and return the answer plus every tool call. */
export async function generateWithTools(opts: { instructions: string; messages: ModelMessage[]; tools: Tool[] }) {
  if (budgetLeft() <= 0) throw new BudgetExceededError("Today's LLM budget is used up. Try again tomorrow.");

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
      model: languageModel(PROVIDER, MODEL),
      instructions: opts.instructions,
      messages: opts.messages,
      tools: modelTools,
      stopWhen: isStepCount(MAX_STEPS),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      timeout: { totalMs: TIMEOUT_MS },
      abortSignal: controller.signal,
      onStepEnd: ({ usage, finishReason }) => {
        recordUsage(PROVIDER, usage);
        // Stop before the next step if this one used up the budget.
        if (finishReason === "tool-calls" && budgetLeft() <= 0) {
          budgetRanOut = true;
          controller.abort();
        }
      },
      onToolExecutionEnd: ({ toolCall, toolOutput }) => {
        steps.push(
          toolOutput.type === "tool-error"
            ? { tool: toolCall.toolName, args: toolCall.input, result: { error: String(toolOutput.error) }, error: true }
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
