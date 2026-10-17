/**
 * The one decision behind `/evidence CODE` (spec W4.7): whether a command the user typed may start its single payment
 * without a click. The page, never the model, makes this call, and only for text the user typed in the prompt bar
 * (the model's get_evidence_bundle card keeps its Pay button: golden rule 1).
 *
 * Exactly one decision per typed command: once it is "pay" or "skip" the command's id is spent, so a re-render, a
 * remount, or a wallet that becomes ready later can never start a second payment. A payment is started only when the
 * wallet is ready and no payment is in flight, finished, or of unknown outcome.
 */
import type { WalletState } from "./chain";
import type { PayState } from "./state";

export type AutoPayDecision = "wait" | "pay" | "skip";

/** Ids of typed commands whose decision was made in this page session. */
export const SPENT = new Set<string>();

export function decideAutoPay(i: {
  /** The id of the typed command, or undefined for a card the model offered (never auto-pays). */
  id: string | undefined;
  spent?: Set<string>;
  /** The wallet and its balances have been read (or there is no wallet to read). */
  settled: boolean;
  state: WalletState;
  pay: PayState["kind"];
  hasUrl: boolean;
}): AutoPayDecision {
  const spent = i.spent ?? SPENT;
  if (!i.id || spent.has(i.id)) return "skip";
  if (!i.settled) return "wait";
  spent.add(i.id);
  return i.hasUrl && i.state === "ready" && i.pay === "idle" ? "pay" : "skip";
}
