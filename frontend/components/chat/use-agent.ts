"use client";

import { useEffect, useState } from "react";
import type { Message, Status, Step, WalletInfo } from "./types";

/** State and fetch calls for the agent console: status, wallet, and the chat history. */
export function useAgent() {
  const [status, setStatus] = useState<Status | null>(null);
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [creating, setCreating] = useState(false);

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

  async function send(text: string) {
    if (!text.trim() || thinking) return;
    const history: Message[] = [...messages, { role: "user", text }];
    setMessages(history);
    setInput("");
    setThinking(true);

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history.filter((m) => !m.error).map(({ role, text }) => ({ role, text })) }),
      });
      const data = await res.json();
      setMessages((m) => [...m, data.error ? { role: "agent", text: data.error, error: true } : { role: "agent", text: data.answer, steps: data.steps }]);
      if (data.steps?.some((s: Step) => s.tool.includes("wallet"))) loadWallet();
    } catch {
      setMessages((m) => [...m, { role: "agent", text: "Could not reach the server. Try again in a moment.", error: true }]);
    }
    setThinking(false);
  }

  return {
    status, wallet, walletError, messages, input, setInput, thinking, creating,
    ready: Boolean(status?.hasApiKey),
    loadWallet, createWallet, send,
    clear: () => setMessages([]),
  };
}
