/**
 * THE CHAT MODEL ALLOWLIST
 *
 * The chat model is chosen by the user, but only from this fixed list. The client sends an entry
 * `id`; the server looks it up here and never passes client text on as a provider or model name.
 * The default entry always comes from the environment (LLM_PROVIDER, LLM_MODEL), so today's
 * behavior is unchanged. Extraction is not selectable (it stays pinned in llm.ts).
 * Every model runs under the same cost guards as the default (per-provider daily budget, rate limits).
 */
import { hasApiKey, MODEL, PROVIDER } from "./llm";

export type ChatModel = { id: string; label: string; provider: string; model: string; note?: string; default?: boolean };

/** What the page may see: no provider, no model string, no key or env names. */
export type PublicChatModel = { id: string; label: string; note: string | null; default: boolean };

const NOT_BENCHMARKED = "not benchmarked for chat";

export const CHAT_MODELS: readonly ChatModel[] = [
  { id: "gemini-flash-lite", label: "Gemini Flash-Lite", provider: "google", model: "gemini-flash-lite-latest" },
  { id: "gemini-flash", label: "Gemini Flash", provider: "google", model: "gemini-flash-latest" },
  { id: "gpt-oss-120b", label: "GPT-OSS 120B", provider: "groq", model: "openai/gpt-oss-120b", note: NOT_BENCHMARKED },
  { id: "nemotron-3-super", label: "Nemotron 3 Super", provider: "openrouter", model: "nvidia/nemotron-3-super-120b-a12b:free", note: NOT_BENCHMARKED },
];

/** The default entry: whatever the environment says. It takes the id and label of the allowlist entry it matches, else a plain "default" entry. */
export function defaultChatModel(): ChatModel {
  const match = CHAT_MODELS.find((m) => m.provider === PROVIDER && m.model === MODEL);
  return { ...(match ?? { id: "default", label: MODEL, note: undefined }), provider: PROVIDER, model: MODEL, default: true };
}

/** The default first, then every other allowlist entry. Only entries whose provider has a key are offered, the default included. */
export function availableChatModels(): ChatModel[] {
  const def = defaultChatModel();
  const rest = CHAT_MODELS.filter((m) => m.id !== def.id && !(m.provider === def.provider && m.model === def.model) && hasApiKey(m.provider));
  return [...(hasApiKey(def.provider) ? [def] : []), ...rest];
}

/**
 * The entry for a client-sent id. Missing means the default. Anything that is not a string naming an
 * available entry (unknown, or its provider has no key) gives null: the caller answers 400.
 */
export function resolveChatModel(id: unknown): ChatModel | null {
  if (id === undefined || id === null) return defaultChatModel();
  if (typeof id !== "string") return null;
  return availableChatModels().find((m) => m.id === id) ?? null;
}

export function toPublic(models: ChatModel[]): PublicChatModel[] {
  return models.map((m) => ({ id: m.id, label: m.label, note: m.note ?? null, default: Boolean(m.default) }));
}
