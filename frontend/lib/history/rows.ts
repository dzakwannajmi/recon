/**
 * Rows for saved chats and saved paid evidence, and the size caps (the same caps are CHECK constraints in
 * supabase/migrations/001_init.sql). Pure: no network. What is stored is only what the user typed, the agent's
 * answer with its tool steps, and the paid bundles the user's own browser bought. Saved text is shown as plain text.
 */
import type { Message, Step } from "@/components/chat/types";

export const MAX_TEXT = 4000;
export const MAX_STEPS_BYTES = 200_000;
export const MAX_BUNDLE_BYTES = 1_000_000;
export const MAX_TITLE = 120;
export const MAX_SESSIONS = 50;
export const MAX_MESSAGES = 200;

export type SessionRow = { id: string; user_id: string; title: string; model: string | null; created_at?: string; updated_at?: string };
export type MessageRow = { id: string; session_id: string; user_id: string; role: "user" | "agent"; text: string; steps: Step[] | null; created_at?: string };
export type EvidenceRow = { user_id: string; asset_code: string; issuer: string; bundle: unknown; settlement_tx: string; paid_at?: string };

const cut = (s: string, n: number) => Array.from(s).slice(0, n).join("");
const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;

/** A chat title: the first user message on one line, cut to 120 characters. */
export function titleOf(messages: Pick<Message, "role" | "text">[]): string {
  const first = messages.find((m) => m.role === "user")?.text ?? "";
  return cut(first.replace(/\s+/g, " ").trim(), MAX_TITLE) || "New chat";
}

/** The steps to store, or null when they are over the cap (the answer text is still saved). */
export function capSteps(steps: Step[] | undefined): Step[] | null {
  if (!steps || steps.length === 0) return null;
  return bytes(steps) <= MAX_STEPS_BYTES ? steps : null;
}

/** A message as a row, or null for an error message or empty text. Text is cut to the 4000-character chat limit. */
export function toMessageRow(userId: string, sessionId: string, id: string, m: Message): MessageRow | null {
  if (m.error) return null;
  const text = cut(m.text, MAX_TEXT);
  if (text.trim() === "") return null;
  return { id, session_id: sessionId, user_id: userId, role: m.role, text, steps: m.role === "agent" ? capSteps(m.steps) : null };
}

/** A stored row back to a chat message. Anything that is not a user or agent row with text is dropped. */
export function fromMessageRow(r: { role?: unknown; text?: unknown; steps?: unknown }): Message | null {
  if ((r.role !== "user" && r.role !== "agent") || typeof r.text !== "string") return null;
  const steps = Array.isArray(r.steps) ? (r.steps.filter((s) => s && typeof s === "object" && typeof (s as Step).tool === "string") as Step[]) : undefined;
  return { role: r.role, text: cut(r.text, MAX_TEXT), ...(r.role === "agent" && steps && steps.length > 0 ? { steps } : {}) };
}

const ASSET = /^[A-Za-z0-9]{1,12}$/;
const ISSUER = /^G[A-Z2-7]{55}$/;

/**
 * Whether to store a paid bundle, and the row if so. Only when: a user is signed in, the payment state is `paid`, the
 * asset and issuer are well formed, a settlement transaction is known, and the response is JSON within the size cap.
 * Anything else returns null and nothing is saved.
 */
export function evidenceRowFor(input: {
  userId: string | null;
  payKind: string;
  assetCode: string;
  issuer: string | null;
  tx: string | null;
  raw: string | null;
}): EvidenceRow | null {
  const { userId, payKind, assetCode, issuer, tx, raw } = input;
  if (!userId || payKind !== "paid" || !raw || !tx || !issuer) return null;
  if (!ASSET.test(assetCode) || !ISSUER.test(issuer) || tx.length > 128) return null;
  if (new TextEncoder().encode(raw).length > MAX_BUNDLE_BYTES) return null;
  let bundle: unknown;
  try {
    bundle = JSON.parse(raw);
  } catch {
    return null;
  }
  if (bundle === null || typeof bundle !== "object" || Array.isArray(bundle)) return null;
  return { user_id: userId, asset_code: assetCode, issuer, bundle, settlement_tx: tx };
}
