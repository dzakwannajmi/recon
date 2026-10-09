/**
 * The configs the W2.6 benchmark compares: two Gemini, one Groq, one OpenRouter (all free tiers). Model IDs are pinned
 * versioned IDs, not the `-latest` aliases (the API's model list does not say
 * which version an alias resolves to, so an alias could change between runs).
 * Chosen 2026-10-08 from `npm run benchmark -- --list-models`: the newest
 * Flash-Lite and Flash whose API entry carries a dated version. The ID
 * strings themselves (`gemini-3.5-flash-lite`, `gemini-3.7-flash`) carry no
 * date; the dated API versions listed that day are `3.5-flash-lite-07-2026`
 * and `3.7-flash-08-2026`. `gemini-3.8-flash` reported version "3.0", not a
 * dated snapshot, so it is not pinned. Each run record also stores the model
 * ID the provider reports in its response (`response_model`), so a silent
 * change behind an ID would show up.
 *
 * Thinking: Gemini 3.x cannot switch thinking off, and thinking tokens count
 * inside the 4096 output cap, so both configs use the lowest level the SDK
 * allows for the model (`thinkingConfig.thinkingLevel`, see
 * getMinimumThinkingLevelForGemini3Model in @ai-sdk/google): "minimal" for
 * Flash-Lite, "low" for Flash 3.7 and later. Reasoning tokens are recorded
 * per call so the scorer can show whether thinking took a share of the cap.
 *
 * gpt-oss (Groq): `openai/gpt-oss-120b` with `providerOptions.groq.reasoningEffort:
 * "low"`. The option's enum in @ai-sdk/groq is none | default | low | medium |
 * high; "none" is only for qwen3.6 there (the SDK warns it is unsupported for
 * other models), so "low" is the lowest effort that works for gpt-oss. The SDK
 * sends `response_format: json_schema` (strict) by default (`structuredOutputs`
 * defaults to true), so nothing else is set. The free tier caps one minute at
 * ~8K tokens (TPM); a single request above the cap answers HTTP 413, which the
 * runner does not retry. If the biggest window does that, `maxOutputTokens`
 * is lowered here (the cap counts toward the request size).
 *
 * nemotron (OpenRouter): `nvidia/nemotron-3-super-120b-a12b:free` through
 * @ai-sdk/openai-compatible (name `openrouter`, structured outputs on, so the
 * request carries `response_format: json_schema`). The openai-compatible chat
 * model copies every key under `providerOptions.openrouter` that is not one
 * of its own options into the request body (see getArgs), so
 * `reasoning: { effort: "low" }` reaches OpenRouter as written. Whether the
 * upstream model honours the effort is up to OpenRouter; reasoning tokens are
 * recorded per call, so the scorer shows what it did. The free tier allows ~50
 * requests a day per account.
 */
import type { ProviderOptions } from "../../agent/llm";

export type BenchConfig = {
  name: string;
  provider: "google" | "groq" | "openrouter";
  model: string;
  providerOptions: ProviderOptions;
  /** Output-token cap for this config; the benchmark default (OUTPUT_TOKENS) when absent. */
  maxOutputTokens?: number;
};

export const CONFIGS: BenchConfig[] = [
  { name: "flash-lite", provider: "google", model: "gemini-3.5-flash-lite", providerOptions: { google: { thinkingConfig: { thinkingLevel: "minimal" } } } },
  { name: "flash", provider: "google", model: "gemini-3.7-flash", providerOptions: { google: { thinkingConfig: { thinkingLevel: "low" } } } },
  { name: "gpt-oss", provider: "groq", model: "openai/gpt-oss-120b", providerOptions: { groq: { reasoningEffort: "low" } } },
  { name: "nemotron", provider: "openrouter", model: "nvidia/nemotron-3-super-120b-a12b:free", providerOptions: { openrouter: { reasoning: { effort: "low" } } } },
];
