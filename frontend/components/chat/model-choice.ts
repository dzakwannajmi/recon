import type { ChatModelInfo } from "./types";

const KEY = "chat-model";

/** The remembered model id, or null (no storage, blocked storage, or nothing saved). */
export function readModelChoice(storage?: Pick<Storage, "getItem">): string | null {
  try {
    // Reading `localStorage` itself can throw when storage is blocked, so it happens inside the try.
    return (storage ?? globalThis.localStorage)?.getItem(KEY) || null;
  } catch {
    return null;
  }
}

export function saveModelChoice(id: string, storage?: Pick<Storage, "setItem">) {
  try {
    (storage ?? globalThis.localStorage)?.setItem(KEY, id);
  } catch {
    // Private mode or blocked storage: the choice just is not remembered.
  }
}

/**
 * The id to use: the remembered one if the server still offers it, else the server's default,
 * else undefined (no list yet; the server then uses its default).
 */
export function effectiveModelId(remembered: string | null, models: ChatModelInfo[] | undefined): string | undefined {
  if (!models?.length) return undefined;
  if (remembered && models.some((m) => m.id === remembered)) return remembered;
  return (models.find((m) => m.default) ?? models[0]).id;
}
