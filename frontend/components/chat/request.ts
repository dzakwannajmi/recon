import type { Message } from "./types";

/**
 * The body of POST /api/agent: only the role and the text of each message that is not an error, plus the model id.
 * Tool steps, saved chats' extras, and paid evidence bundles are never part of it (the model must not see issuer
 * quotes from a paid bundle; golden rule 3).
 */
export function agentRequestBody(messages: Message[], modelId?: string | null): string {
  return JSON.stringify({ messages: messages.filter((m) => !m.error).map(({ role, text }) => ({ role, text })), ...(modelId ? { model: modelId } : {}) });
}
