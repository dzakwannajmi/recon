"use client";

import { useEffect, useRef, useState } from "react";
import { readHandoff, shouldAutoSend } from "./handoff";
import type { Message, Reply, Status, Step, WalletInfo } from "./types";

/** State and fetch calls for the agent console: status, wallet, and the chat history. */
export function useAgent() {
  const [status, setStatus] = useState<Status | null>(null);
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [creating, setCreating] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const handoff = useRef<string | null>(null);
  const handoffSent = useRef(false);

  const loadWallet = () => fetch("/api/wallet").then((r) => r.json()).then(setWallet);

  useEffect(() => {
    fetch("/api/agent").then((r) => r.json()).then(setStatus);
    loadWallet();
  }, []);

  async function createWallet() {
    setCreating(true);
    setWalletError(null);
    try {
      const res = await fetch("/api/wallet", { method: "POST" });
      if (!res.ok) setWalletError((await res.json().catch(() => null))?.error ?? "Could not create the wallet.");
      await loadWallet();
    } catch {
      setWalletError("Could not reach the server. Try again in a moment.");
    } finally {
      setCreating(false);
    }
  }

  async function send(text: string): Promise<Reply> {
    if (!text.trim() || thinking) return null;
    const history: Message[] = [...messages, { role: "user", text }];
    setMessages(history);
    setInput("");
    setThinking(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const started = performance.now();
    let reply: Reply;

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history.filter((m) => !m.error).map(({ role, text }) => ({ role, text })) }),
        signal: controller.signal,
      });
      const data = await res.json();
      const elapsed = (performance.now() - started) / 1000;
      reply = data.error ? { text: String(data.error), error: true } : { text: String(data.answer ?? ""), error: false };
      setMessages((m) => [...m, data.error ? { role: "agent", text: data.error, error: true } : { role: "agent", text: data.answer, steps: data.steps, elapsed }]);
      if (data.steps?.some((s: Step) => s.tool.includes("wallet"))) loadWallet();
    } catch (e) {
      if (controller.signal.aborted || (e as Error).name === "AbortError") {
        reply = null;
      } else {
        reply = { text: "Could not reach the server. Try again in a moment.", error: true };
        setMessages((m) => [...m, { role: "agent", text: reply!.text, error: true }]);
      }
    }
    abortRef.current = null;
    setThinking(false);
    return reply;
  }

  /** Stops waiting for the answer. The server may still finish; the reply is dropped. */
  function stop() {
    abortRef.current?.abort();
  }

  // A question handed over by the landing page (see handoff.ts), sent once when the agent is ready.
  const handoffRead = useRef(false);
  useEffect(() => {
    if (handoffRead.current) return; // development runs effects twice; the stored token can be read only once
    handoffRead.current = true;
    handoff.current = readHandoff(window.location.search, window.sessionStorage);
    if (new URLSearchParams(window.location.search).has("q")) window.history.replaceState(null, "", window.location.pathname);
  }, []);
  const ready = Boolean(status?.hasApiKey);
  useEffect(() => {
    if (!shouldAutoSend({ query: handoff.current, ready, thinking, sent: handoffSent.current })) return;
    handoffSent.current = true;
    void send(handoff.current!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, thinking]);

  return {
    status, wallet, walletError, messages, input, setInput, thinking, creating,
    ready,
    loadWallet, createWallet, send, stop,
    clear: () => setMessages([]),
  };
}
