/**
 * What `npm run check:paid` exits with (spec 8.2): 0 done, 1 refused before paying, 2 paid without a
 * response, 3 not settled. Pure. The rule that matters: once the paid request has been sent, no failure
 * may report "refused before paying" (1), because money may have moved.
 */
export type RunState = {
  /** The paid request was started (set before it is sent). */
  paidSent: boolean;
  /** A 200 with a successful settlement response arrived. */
  delivered: boolean;
  /** Horizon check of the settlement: confirmed, contradicted (mismatch), could not be read, or not attempted. */
  confirmation: "confirmed" | "mismatch" | "unreadable" | "pending";
  /** When nothing was delivered: did the chain poll find a transfer, find none, or fail? */
  chain: "found" | "none" | "unknown" | "pending";
  /** The optional replay check. */
  replay: "not_run" | "refused" | "not_refused" | "second_transfer" | "error";
};

export const newRunState = (): RunState => ({ paidSent: false, delivered: false, confirmation: "pending", chain: "pending", replay: "not_run" });

export type ExitCode = 0 | 1 | 2 | 3;

export function exitCode(s: RunState): ExitCode {
  if (!s.paidSent) return 1;
  if (s.delivered) {
    if (s.confirmation === "mismatch") return 3;
    if (s.confirmation !== "confirmed") return 2; // the response came, but the chain was not read: possibly paid
    return s.replay === "not_refused" || s.replay === "second_transfer" || s.replay === "error" ? 3 : 0;
  }
  // No settled response. Only a chain poll that found nothing proves that nothing moved.
  return s.chain === "none" ? 3 : 2;
}

/** One fixed sentence for the final line of a stopped run. It carries no library text, no amount, no secret. */
export function stoppedSentence(s: RunState, stage: string): string {
  return s.paidSent
    ? `Stopped during ${stage} after the paid request was sent, so the outcome is unknown. Check the receiving account for an incoming transfer before paying again.`
    : `Stopped during ${stage} before any payment was sent.`;
}
