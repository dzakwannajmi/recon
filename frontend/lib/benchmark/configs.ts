/**
 * The two Gemini configs the W2.6 benchmark compares. Model IDs are pinned
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
 */
import type { ProviderOptions } from "../../agent/llm";

export type BenchConfig = { name: string; model: string; providerOptions: ProviderOptions };

export const CONFIGS: BenchConfig[] = [
  { name: "flash-lite", model: "gemini-3.5-flash-lite", providerOptions: { google: { thinkingConfig: { thinkingLevel: "minimal" } } } },
  { name: "flash", model: "gemini-3.7-flash", providerOptions: { google: { thinkingConfig: { thinkingLevel: "low" } } } },
];
