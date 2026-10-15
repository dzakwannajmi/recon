/**
 * The landing page hands a question to /agent as /agent?q=<text>. A link can be forged, so /agent sends the
 * question on its own only when the landing page, in this same tab, stored the same text first. Any other
 * ?q= is ignored: it is never sent and never shown.
 */
export const MAX_QUERY_CHARS = 500;
export const HANDOFF_KEY = "agent:handoff";

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const cleanQuery = (text: string) => text.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, MAX_QUERY_CHARS);

/** The /agent link for a question, and the text to store so /agent will accept it. */
export function handoffFor(text: string): { href: string; token: string } | null {
  const token = cleanQuery(text);
  return token ? { href: `/agent?q=${encodeURIComponent(token)}`, token } : null;
}

/** Call from the landing page just before navigating. Storage can be blocked: then the question is just not auto-sent. */
export function storeHandoff(store: Store, token: string) {
  try {
    store.setItem(HANDOFF_KEY, token);
  } catch {}
}

/** The question to auto-send, or null. Always clears the stored token so a reload cannot send it again. */
export function readHandoff(search: string, store: Store): string | null {
  let stored: string | null = null;
  try {
    stored = store.getItem(HANDOFF_KEY);
    store.removeItem(HANDOFF_KEY);
  } catch {}
  const q = new URLSearchParams(search).get("q");
  if (q === null || stored === null) return null;
  const query = cleanQuery(q);
  return query !== "" && query === stored ? query : null;
}

/** Send once, only when the agent is set up and idle. */
export function shouldAutoSend(s: { query: string | null; ready: boolean; thinking: boolean; sent: boolean }): boolean {
  return s.query !== null && s.ready && !s.thinking && !s.sent;
}
