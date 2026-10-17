"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { addTrustline, friendbot, readSnapshot, walletState, type Snapshot, type WalletState } from "@/lib/browser-payer/chain";
import { payForDetail } from "@/lib/browser-payer/pay";
import { IDLE, payReducer, type PayState } from "@/lib/browser-payer/state";
import { browserStore, burnerKey, clearUnknown, createBurner, forgetSecret, loadSecret, loadUnknown, saveUnknown, type PayerKey } from "@/lib/browser-payer/storage";
import { toBundleView, type BundleView } from "@/lib/browser-payer/bundle";

const CHANGED = "payer-wallet-changed";
const announce = () => window.dispatchEvent(new Event(CHANGED));

/**
 * The browser testnet payer for the Unlock evidence card. The secret lives in this hook's memory and in localStorage;
 * the page only ever gets the address. Every network step is started by a click.
 */
export function usePayer() {
  const [secret, setSecret] = useState<string | null>(null);
  const [kept, setKept] = useState(true);
  const [snap, setSnap] = useState<Snapshot | "unreadable" | null>(null);
  const [busy, setBusy] = useState<"fund" | "trust" | "refresh" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pay, dispatch] = useReducer(payReducer, IDLE as PayState);
  const [bundle, setBundle] = useState<BundleView | null>(null);
  const inFlight = useRef(false);

  const key: PayerKey | null = useMemo(() => {
    try {
      return secret ? burnerKey(secret) : null;
    } catch {
      return null;
    }
  }, [secret]);

  const refresh = useCallback(async () => {
    if (!key) return;
    setBusy("refresh");
    setSnap(await readSnapshot(key.address, fetch));
    setBusy(null);
  }, [key]);

  useEffect(() => {
    const load = () => {
      const store = browserStore();
      setSecret(loadSecret(store));
      dispatch({ type: "sync", unknown: loadUnknown(store) });
    };
    load();
    window.addEventListener(CHANGED, load);
    window.addEventListener("storage", load);
    return () => {
      window.removeEventListener(CHANGED, load);
      window.removeEventListener("storage", load);
    };
  }, []);

  useEffect(() => {
    setSnap(null);
    if (key) void refresh();
  }, [key, refresh]);

  function create() {
    const made = createBurner(browserStore());
    setKept(made.kept);
    setSecret(made.seed);
    setNotice(null);
    announce();
  }

  function forget() {
    forgetSecret(browserStore());
    setSecret(null);
    setSnap(null);
    setBundle(null);
    // The unknown-outcome marker is deliberately kept: forgetting the wallet does not make a possible payment safe to repeat.
    announce();
  }

  async function fund() {
    if (!key) return;
    setBusy("fund");
    const r = await friendbot(key.address, fetch);
    setNotice(r.ok ? null : r.message);
    await refresh();
    setBusy(null);
  }

  async function trust() {
    if (!key) return;
    setBusy("trust");
    const r = await addTrustline(key, fetch);
    setNotice(r.ok ? null : r.message);
    await refresh();
    setBusy(null);
  }

  async function payFor(url: string) {
    // One payment at a time, started only by a click; the state machine also refuses a start while paying, paid, or unknown.
    if (inFlight.current || !key || snap === null || snap === "unreadable") return;
    if (pay.kind !== "idle" && pay.kind !== "failed") return;
    inFlight.current = true;
    dispatch({ type: "start" });
    try {
      const outcome = await payForDetail({ url, key, balanceBase: snap.usdcBase, fetchFn: fetch });
      if (outcome.kind === "paid") setBundle(toBundleView(outcome.body));
      if (outcome.kind === "unknown") {
        saveUnknown(browserStore(), { tx: outcome.tx });
        announce();
      }
      dispatch({ type: "result", outcome });
    } finally {
      inFlight.current = false;
    }
    void refresh();
  }

  /** Only the user's click clears the shared marker. */
  function acknowledge() {
    clearUnknown(browserStore());
    dispatch({ type: "acknowledge" });
    announce();
  }

  const state: WalletState = walletState(Boolean(key), snap === "unreadable" ? null : snap);
  return { address: key?.address ?? null, kept, snap, state, busy, notice, pay, bundle, create, forget, fund, trust, refresh, payFor, acknowledge };
}
