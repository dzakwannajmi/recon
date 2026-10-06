/**
 * THE MODEL LAYER
 *
 * Every LLM call goes through this file, so the provider can change by
 * config alone (decision D-017). Cost guards live here too (D-016):
 * a daily token budget counted per step, a step limit, an output-token cap,
 * and a timeout. The guard fails closed: if usage can't be read or saved,
 * no new calls start.
 *
 * Usage is counted per server in `.cache/llm-usage.json` (git-ignored).
 */
import fs from "fs";
import path from "path";
import { generateText, isStepCount, jsonSchema, Output, tool, type LanguageModelUsage, type ModelMessage } from "ai";
import type { z } from "zod";
import { createGoogle } from "@ai-sdk/google";
import { positiveInt } from "@/lib/env";
import type { Tool } from "./tools";

export const PROVIDER = process.env.LLM_PROVIDER || "google";
export const MODEL = process.env.LLM_MODEL || "gemini-flash-latest";
/** Batch extraction can use a different (e.g. faster) model; the W2.6 benchmark picks the final one. */
export const EXTRACT_MODEL = process.env.LLM_EXTRACT_MODEL || MODEL;

const DAILY_TOKEN_BUDGET = positiveInt("LLM_DAILY_TOKEN_BUDGET", 200_000);
const MAX_OUTPUT_TOKENS = positiveInt("LLM_MAX_OUTPUT_TOKENS", 1024);
const MAX_STEPS = 5;
const TIMEOUT_MS = 60_000;
const USAGE_FILE = path.join(process.cwd(), ".cache", "llm-usage.json");

export type Step = { tool: string; args: unknown; result: unknown; error?: boolean };

/** The daily budget is used up. Its message is safe to show. */
export class BudgetExceededError extends Error {}

export function hasApiKey() {
  if (PROVIDER === "google") return Boolean(process.env.GEMINI_API_KEY);
  return false;
}

function languageModel(model = MODEL) {
  if (PROVIDER === "google") return createGoogle({ apiKey: process.env.GEMINI_API_KEY })(model);
  throw new Error(`LLM provider "${PROVIDER}" is not set up yet.`);
}

type Usage = { day: string; tokens: number };

let usageUnavailable = false;

function today() {
  return new Date().toISOString().slice(0, 10);
}

function readUsage(): Usage {
  try {
    const usage = JSON.parse(fs.readFileSync(USAGE_FILE, "utf8")) as Usage;
    return usage.day === today() ? usage : { day: today(), tokens: 0 };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { day: today(), tokens: 0 };
    usageUnavailable = true;
    return { day: today(), tokens: DAILY_TOKEN_BUDGET };
  }
}

function recordUsage(usage: LanguageModelUsage) {
  const tokens = usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
  if (!tokens) return;
  try {
    const current = readUsage();
    current.tokens += tokens;
    fs.mkdirSync(path.dirname(USAGE_FILE), { recursive: true });
    const tmp = `${USAGE_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(current));
    fs.renameSync(tmp, USAGE_FILE);
  } catch (err) {
    usageUnavailable = true;
    console.error("LLM usage could not be saved:", (err as Error).name);
  }
}

export function budgetLeft() {
  if (usageUnavailable) return 0;
  return Math.max(0, DAILY_TOKEN_BUDGET - readUsage().tokens);
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
      model: languageModel(),
      instructions: opts.instructions,
      messages: opts.messages,
      tools: modelTools,
      stopWhen: isStepCount(MAX_STEPS),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      timeout: { totalMs: TIMEOUT_MS },
      abortSignal: controller.signal,
      onStepEnd: ({ usage, finishReason }) => {
        recordUsage(usage);
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

/**
 * One structured-output call with no tools, for quarantined extraction from
 * untrusted documents. It counts against the same daily budget and fails
 * closed the same way. Returns the parsed output and the tokens used.
 */
export async function generateStructured<T>(opts: { instructions: string; prompt: string; schema: z.ZodType<T>; maxOutputTokens?: number; model?: string }) {
  if (budgetLeft() <= 0) throw new BudgetExceededError("Today's LLM budget is used up. Try again tomorrow.");
  const result = await generateText({
    model: languageModel(opts.model ?? EXTRACT_MODEL),
    instructions: opts.instructions,
    prompt: opts.prompt,
    output: Output.object({ schema: opts.schema }),
    maxOutputTokens: opts.maxOutputTokens ?? 4096,
    timeout: { totalMs: 120_000 },
    onStepEnd: ({ usage }) => recordUsage(usage),
  });
  const usage = result.totalUsage;
  return { output: result.output as T, tokens: usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) };
}
