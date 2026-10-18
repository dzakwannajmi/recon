"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { browserClient } from "@/lib/auth/client";
import type { AuthUser } from "@/lib/auth/user";
import { appendMessages, createSession, deleteEvidence, deleteSession, listEvidence, listSessions, loadMessages, type EvidenceItem, type SessionItem } from "@/lib/history/store";
import type { Message } from "./types";

const CHANGED = "history-changed";
/** Tells every list on the page to reload (after "Delete my data", or a saved bundle). */
export const announceHistoryChanged = () => {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGED));
};

const newId = () => crypto.randomUUID();

/**
 * Saved chats for the signed-in user: the list, the chat that is open, and saving each finished exchange.
 * Signed out: nothing is read or written. A save that fails only shows a note; the chat itself keeps working.
 */
export function useHistory(user: AuthUser | null, model: string | null) {
  const userId = user?.id ?? null;
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Saves run one after another, so a chat exists before its messages are added.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const currentRef = useRef<string | null>(null);
  currentRef.current = current;

  const reload = useCallback(async () => {
    const db = browserClient();
    if (!db || !userId) {
      setSessions([]);
      setEvidence([]);
      return;
    }
    try {
      const [s, e] = await Promise.all([listSessions(db), listEvidence(db)]);
      setSessions(s);
      setEvidence(e);
      setError(null);
    } catch {
      setError("Could not load your saved items.");
    }
  }, [userId]);

  useEffect(() => {
    void reload();
    const onChange = () => {
      setCurrent(null);
      void reload();
    };
    window.addEventListener(CHANGED, onChange);
    return () => window.removeEventListener(CHANGED, onChange);
  }, [reload]);

  /** Saves one finished exchange (the user's message and the agent's answer). Error replies are not saved. */
  const record = useCallback(
    (pair: Message[]) => {
      const db = browserClient();
      if (!db || !userId || pair.every((m) => m.error)) return;
      queue.current = queue.current.then(async () => {
        try {
          let id = currentRef.current;
          if (!id) {
            id = newId();
            currentRef.current = id;
            setCurrent(id);
            await createSession(db, userId, id, pair, model);
          }
          await appendMessages(db, userId, id, pair.map((message) => ({ id: newId(), message })));
          setSessions(await listSessions(db));
          setError(null);
        } catch {
          setError("Could not save this chat.");
        }
      });
    },
    [userId, model],
  );

  async function open(id: string): Promise<Message[] | null> {
    const db = browserClient();
    if (!db) return null;
    try {
      const messages = await loadMessages(db, id);
      setCurrent(id);
      setError(null);
      return messages;
    } catch {
      setError("Could not open that chat.");
      return null;
    }
  }

  async function remove(id: string) {
    const db = browserClient();
    if (!db) return;
    try {
      await deleteSession(db, id);
      if (currentRef.current === id) setCurrent(null);
      await reload();
    } catch {
      setError("Could not delete that chat.");
    }
  }

  async function removeEvidence(id: string) {
    const db = browserClient();
    if (!db) return;
    try {
      await deleteEvidence(db, id);
      await reload();
    } catch {
      setError("Could not delete that evidence.");
    }
  }

  return { sessions, evidence, current, error, record, open, remove, removeEvidence, startNew: () => setCurrent(null), reload };
}
