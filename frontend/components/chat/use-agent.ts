"use client";

import { useEffect, useRef, useState } from "react";
import { effectiveModelId, readModelChoice, saveModelChoice } from "./model-choice";
import { parseTyped, type TypedCommand } from "@/lib/commands";
import { readHandoff, shouldAutoSend } from "./handoff";
import { agentRequestBody } from "./request";
import type { Message, Reply, Status, Step, WalletInfo } from "./types";

/** A fresh id for one typed command. Never reused, so its decision (lib/browser-payer/auto.ts) is made once. */
const newCommandId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

type Options = {
  /** A user is signed in. With AUTH_REQUIRED on (status.authRequired) the chat waits for this. */
  signedIn?: boolean;
  /** Called with the user's message and the agent's answer after each successful exchange (saves the chat). */
  onExchange?: (pair: Message[]) => void;
};

/** State and fetch calls for the agent console: status, wallet, and the chat history. */
/** Index of the last user message, or -1. */
const lastUser = (messages: Message[]) => messages.map((m) => m.role).lastIndexOf("user");

export function useAgent({ signedIn = false, onExchange }: Options = {}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [creating, setCreating] = useState(false);
  const [remembered, setRemembered] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const handoff = useRef<string | null>(null);
  const handoffSent = useRef(false);
  const exchange = useRef(onExchange);
  exchange.current = onExchange;

  const loadWallet = () => fetch("/api/wallet").then((r) => r.json()).then(setWallet);

  useEffect(() => {
    setRemembered(readModelChoice());
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

  /** The chosen chat model id: the remembered one if the server offers it, else the server's default. */
  const modelId = effectiveModelId(remembered, status?.models);
  function setModelId(id: string) {
    setRemembered(id);
    saveModelChoice(id);
  }

  async function send(text: string, again = false): Promise<Reply> {
    if (!text.trim() || thinking) return null;
    // "Try again" drops the old answer and asks the same question; the user's message is not repeated.
    const history: Message[] = again ? messages.slice(0, lastUser(messages) + 1) : [...messages, { role: "user", text }];
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
        body: agentRequestBody(history, modelId),
        signal: controller.signal,
      });
      const data = await res.json();
      const elapsed = (performance.now() - started) / 1000;
      reply = data.error ? { text: String(data.error), error: true } : { text: String(data.answer ?? ""), error: false };
      const answer: Message = data.error ? { role: "agent", text: data.error, error: true } : { role: "agent", text: data.answer, steps: data.steps, elapsed };
      setMessages((m) => [...m, answer]);
      if (!data.error) exchange.current?.(again ? [answer] : [history[history.length - 1], answer]);
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

  /**
   * Runs a slash command without the model: POST /api/command runs the matching tool and answers with a short text
   * and the tool step, shown like any chat answer. A typed `/evidence CODE` gets a fresh id, which lets its card pay once
   * without a click when the wallet is ready (lib/browser-payer/auto.ts); every other card keeps its Pay button.
   */
  async function runCommand(typed: TypedCommand, text: string): Promise<Reply> {
    if (thinking) return null;
    setMessages((m) => [...m, { role: "user", text }]);
    setInput("");
    setThinking(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const started = performance.now();
    let reply: Reply;
    try {
      const res = await fetch("/api/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: typed.command, code: typed.code }),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      const elapsed = (performance.now() - started) / 1000;
      if (!res.ok || data.error || !Array.isArray(data.steps)) {
        reply = { text: String(data.error ?? "The command could not be completed. Try again in a moment."), error: true };
        setMessages((m) => [...m, { role: "agent", text: reply!.text, error: true }]);
      } else {
        reply = { text: String(data.text ?? ""), error: false };
        const answer: Message = { role: "agent", text: reply.text, steps: data.steps, elapsed, command: true, ...(typed.command === "evidence" ? { autoPayId: newCommandId() } : {}) };
        setMessages((m) => [...m, answer]);
        exchange.current?.([{ role: "user", text }, answer]);
      }
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

  /** What the user typed or picked in the prompt bar: a whole slash command runs directly, anything else goes to the model. */
  function submit(text: string): Promise<Reply> {
    const typed = parseTyped(text);
    return typed ? runCommand(typed, text.trim()) : send(text);
  }

  /** Asks the last question again (model answers only; a slash command is never repeated, so it cannot pay twice). */
  function regenerate(): Promise<Reply> {
    const i = lastUser(messages);
    const last = messages[messages.length - 1];
    if (i < 0 || thinking || !last || last.role !== "agent" || last.command || parseTyped(messages[i].text)) return Promise.resolve(null);
    return send(messages[i].text, true);
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
  // With AUTH_REQUIRED on, the agent is not ready until a user is signed in (the server refuses otherwise).
  const needsSignIn = Boolean(status?.authRequired) && !signedIn;
  const ready = Boolean(status?.hasApiKey) && !needsSignIn;
  useEffect(() => {
    if (!shouldAutoSend({ query: handoff.current, ready, thinking, sent: handoffSent.current })) return;
    handoffSent.current = true;
    void send(handoff.current!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, thinking]);

  return {
    status, wallet, walletError, messages, input, setInput, thinking, creating,
    modelId, setModelId,
    ready, needsSignIn,
    loadWallet, createWallet, send, submit, regenerate, stop,
    clear: () => setMessages([]),
    load: (m: Message[]) => setMessages(m),
  };
}
