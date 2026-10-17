/**
 * The pay button's state machine (spec W4.7). Pure. A payment is never retried by code: only a user click starts one,
 * and after an unknown outcome the user must first say they checked the explorer.
 */
export type PayState =
  | { kind: "idle" }
  | { kind: "paying" }
  | { kind: "paid"; tx: string }
  | { kind: "failed"; message: string }
  | { kind: "unknown"; tx: string | null };

export type PayOutcome =
  | { kind: "paid"; tx: string; body: unknown; /** The response text exactly as received (for the JSON download). */ raw?: string }
  | { kind: "failed"; message: string }
  | { kind: "unknown"; tx: string | null };

/** `sync` brings a card in line with the shared marker in storage (another card, a reload, another tab). */
export type PayEvent = { type: "start" } | { type: "result"; outcome: PayOutcome } | { type: "acknowledge" } | { type: "sync"; unknown: { tx: string | null } | null };

export const IDLE: PayState = { kind: "idle" };

export function payReducer(state: PayState, event: PayEvent): PayState {
  switch (event.type) {
    case "start":
      // Only from idle, or after a failure that happened before any payment was sent.
      return state.kind === "idle" || state.kind === "failed" ? { kind: "paying" } : state;
    case "result": {
      if (state.kind !== "paying") return state;
      const o = event.outcome;
      if (o.kind === "paid") return { kind: "paid", tx: o.tx };
      if (o.kind === "failed") return { kind: "failed", message: o.message };
      return { kind: "unknown", tx: o.tx };
    }
    case "sync": {
      if (state.kind === "paying" || state.kind === "paid") return state;
      if (event.unknown) return state.kind === "unknown" ? state : { kind: "unknown", tx: event.unknown.tx };
      return state.kind === "unknown" ? IDLE : state;
    }
    case "acknowledge":
      // The user checked the explorer; this is the only way out of "unknown". A paid state stays paid.
      return state.kind === "unknown" ? IDLE : state;
  }
}
