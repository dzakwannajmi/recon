/**
 * Saved chats and saved evidence over Supabase, with the client injected so tests run without a network. Every
 * call runs as the signed-in user: Row Level Security (supabase/migrations/001_init.sql) lets a user touch only rows
 * where auth.uid() = user_id, so a wrong id here cannot reach another user's data. Saving never calls the model.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Message } from "@/components/chat/types";
import { MAX_MESSAGES, MAX_SESSIONS, cleanTitle, fromMessageRow, titleOf, toMessageRow, type EvidenceRow } from "./rows";

export type Db = Pick<SupabaseClient, "from">;
export type SessionItem = { id: string; title: string; updated_at: string; pinned: boolean };
export type EvidenceItem = { id: string; asset_code: string; issuer: string; settlement_tx: string; paid_at: string; bundle: unknown };

// The Supabase error (a code and a message about the request, never row content) goes to the browser console so a failed save can be diagnosed.
const fail = (what: string, error?: { code?: string; message?: string } | null): never => {
  if (error) console.warn(`History: could not ${what}`, error.code ?? "", error.message ?? "");
  throw new Error(`Could not ${what}.`);
};

export async function listSessions(db: Db): Promise<SessionItem[]> {
  const { data, error } = await db.from("chat_sessions").select("id,title,updated_at,pinned").order("pinned", { ascending: false }).order("updated_at", { ascending: false }).limit(MAX_SESSIONS);
  if (error) fail("load saved chats", error);
  return (data ?? []) as SessionItem[];
}

export async function createSession(db: Db, userId: string, id: string, messages: Message[], model: string | null): Promise<void> {
  const { error } = await db.from("chat_sessions").insert({ id, user_id: userId, title: titleOf(messages), model });
  if (error) fail("save the chat", error);
}

/** Appends finished messages (error messages are skipped) and bumps the chat's updated_at. */
export async function appendMessages(db: Db, userId: string, sessionId: string, items: { id: string; message: Message }[]): Promise<void> {
  const rows = items.map((i) => toMessageRow(userId, sessionId, i.id, i.message)).filter((r) => r !== null);
  if (rows.length === 0) return;
  const { error } = await db.from("chat_messages").insert(rows);
  if (error) fail("save the messages", error);
  await db.from("chat_sessions").update({ updated_at: new Date().toISOString() }).eq("id", sessionId);
}

export async function loadMessages(db: Db, sessionId: string): Promise<Message[]> {
  const { data, error } = await db.from("chat_messages").select("role,text,steps").eq("session_id", sessionId).order("created_at", { ascending: true }).limit(MAX_MESSAGES);
  if (error) fail("open the chat", error);
  return (data ?? []).map(fromMessageRow).filter((m): m is Message => m !== null);
}

/** Renames a chat. The title is cleaned first; an empty one is refused. */
export async function renameSession(db: Db, sessionId: string, title: string): Promise<void> {
  const clean = cleanTitle(title);
  if (!clean) throw new Error("Could not rename the chat.");
  const { error } = await db.from("chat_sessions").update({ title: clean }).eq("id", sessionId);
  if (error) fail("rename the chat", error);
}

/** Pins a chat to the top of the list, or unpins it. */
export async function setPinned(db: Db, sessionId: string, pinned: boolean): Promise<void> {
  const { error } = await db.from("chat_sessions").update({ pinned }).eq("id", sessionId);
  if (error) fail("pin the chat", error);
}

/** Deleting a chat removes its messages too (ON DELETE CASCADE). */
export async function deleteSession(db: Db, sessionId: string): Promise<void> {
  const { error } = await db.from("chat_sessions").delete().eq("id", sessionId);
  if (error) fail("delete the chat", error);
}

/** Saved after a successful payment. A repeat of the same settlement is ignored (unique key), not an error. */
export async function saveEvidence(db: Db, row: EvidenceRow): Promise<void> {
  const { error } = await db.from("paid_evidence").upsert(row, { onConflict: "user_id,asset_code,issuer,settlement_tx", ignoreDuplicates: true });
  if (error) fail("save the evidence", error);
}

export async function listEvidence(db: Db, filter?: { assetCode: string; issuer: string }): Promise<EvidenceItem[]> {
  let q = db.from("paid_evidence").select("id,asset_code,issuer,settlement_tx,paid_at,bundle");
  if (filter) q = q.eq("asset_code", filter.assetCode).eq("issuer", filter.issuer);
  const { data, error } = await q.order("paid_at", { ascending: false }).limit(MAX_SESSIONS);
  if (error) fail("load saved evidence", error);
  return (data ?? []) as EvidenceItem[];
}

export async function deleteEvidence(db: Db, id: string): Promise<void> {
  const { error } = await db.from("paid_evidence").delete().eq("id", id);
  if (error) fail("delete the evidence", error);
}

/**
 * "Delete my data": removes every saved chat (messages follow by cascade) and every saved bundle of this user.
 * Scoped by user_id here and again by Row Level Security. The sign-in account itself stays until the user asks
 * for it to be removed.
 */
export async function deleteMyData(db: Db, userId: string): Promise<void> {
  const evidence = await db.from("paid_evidence").delete().eq("user_id", userId);
  const sessions = await db.from("chat_sessions").delete().eq("user_id", userId);
  if (evidence.error || sessions.error) fail("delete your data");
}
