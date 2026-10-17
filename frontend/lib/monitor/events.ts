/**
 * Monitor events (D-047, spec 4.6 and 4.10). Pure. An event is a trigger for a re-check and a line
 * in the log; it never sets a flag (the deciders in lib/flags do) and never states a judgment.
 */
import { createHash } from "node:crypto";
import { formatStroops, toStroops } from "../chain/asset";
import type { HorizonOp, IssuerEvent, PendingEvent } from "./types";
import { opLedger } from "./types";
import { dayOf, type AssetOp } from "./reconcile";
import type { IssuerChange } from "./classify";

const hash16 = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

export const opEventId = (type: string, opId: string) => hash16(`${type}:${opId}`);
export const largeEventId = (asset: string, day: string, side: "mint" | "burn") => hash16(`large:${asset}:${day}:${side}`);
export const unreconciledEventId = (asset: string, from: string | number, to: string | number) => hash16(`unreconciled:${asset}:${from}:${to}`);

/** The event for a successful `set_options` or `account_merge` by a pinned issuer. */
export function issuerChangeEvent(op: HorizonOp, issuer: string, assets: readonly string[], change: IssuerChange, seenAt: string): IssuerEvent {
  return {
    kind: "event", id: opEventId(change.type, op.id), seen_at: seenAt, type: change.type, issuer, assets: [...assets],
    ledger: opLedger(op), ledger_closed_at: op.created_at, tx_hash: op.transaction_hash, op_id: op.id,
    ...(change.changes.length > 0 ? { changes: change.changes } : {}),
  };
}

type Intraday = { date: string; minted: string; burned: string };

/** Today's mint and burn sums: reset on a new UTC day, then add this run's ops dated today. */
export function updateIntraday(prev: Intraday, today: string, ops: readonly AssetOp[]): Intraday {
  let [minted, burned] = prev.date === today ? [toStroops(prev.minted), toStroops(prev.burned)] : [0n, 0n];
  for (const op of ops) {
    if (dayOf(op.at) !== today) continue;
    if (op.side === "mint") minted += op.amount;
    else burned += op.amount;
  }
  return { date: today, minted: formatStroops(minted), burned: formatStroops(burned) };
}

/**
 * One `large_mint_burn` event per (asset, UTC day, side) when today's sum is more than 20% of the base
 * (amount x 5 > base, exactly). The base is the larger of the newest supply point and the newest point
 * from before today. Sides already raised today (`seen`) are skipped.
 */
export function intradayLarge(args: {
  asset: string; issuer: string; today: string; intraday: Intraday; seen: readonly string[]; base: bigint | null;
  latest: Record<"mint" | "burn", AssetOp | null>; seenAt: string;
}): { events: IssuerEvent[]; seen: string[] } {
  const seen = [...args.seen];
  const events: IssuerEvent[] = [];
  const { base } = args;
  if (base === null || base <= 0n) return { events, seen };
  for (const [side, total] of [["mint", toStroops(args.intraday.minted)], ["burn", toStroops(args.intraday.burned)]] as const) {
    const key = `${args.today}:${side}`;
    if (total * 5n <= base || seen.includes(key)) continue;
    const op = args.latest[side];
    seen.push(key);
    events.push({
      kind: "event", id: largeEventId(args.asset, args.today, side), seen_at: args.seenAt, type: "large_mint_burn", issuer: args.issuer, assets: [args.asset],
      ledger: op?.ledger ?? null, ledger_closed_at: op?.at ?? args.seenAt, ...(op ? { tx_hash: op.tx } : {}),
      side, amount: formatStroops(total), base: formatStroops(base), share: (Number((total * 10_000n) / base) / 100).toString(),
    });
  }
  return { events, seen: seen.slice(-40) };
}

/**
 * Pending events not yet covered: an event is covered once every asset it names has a chain check at or after the
 * event's time. (At, not only after: an unreconciled interval ends exactly at the newest check's own reading.)
 */
export function uncoveredPending(pending: readonly PendingEvent[], newestCheckAt: (asset: string) => string | null): PendingEvent[] {
  return pending.filter((p) => !p.assets.every((a) => {
    const t = newestCheckAt(a);
    return t !== null && Date.parse(t) >= Date.parse(p.ledger_closed_at);
  }));
}

/** First 6 and last 4 characters of an account key. */
export const shortKey = (key: string) => `${key.slice(0, 6)}…${key.slice(-4)}`;
const shorten = (s: string) => s.replace(/\bG[A-Z2-7]{55}\b/g, shortKey);

/** One neutral line for the terminal (spec 4.10 wording). */
export function describeEvent(e: IssuerEvent): string {
  const at = `at ledger ${e.ledger ?? "n/a"} (${e.ledger_closed_at})`;
  switch (e.type) {
    case "issuer_options": return `set_options by issuer ${shortKey(e.issuer)} ${at}: ${shorten((e.changes ?? []).join("; ") || "no listed field changed")}`;
    case "issuer_merged": return `account_merge by issuer ${shortKey(e.issuer)} ${at}`;
    case "large_mint_burn": return `${e.side} of ${e.amount} for ${e.assets.join(", ")} on ${e.ledger_closed_at.slice(0, 10)} is ${e.share}% of ${e.base} (supply base) ${at}`;
    case "supply_unreconciled": return `supply change of ${e.assets.join(", ")} is not explained by the classified operations ${at}: ${(e.changes ?? []).join("; ")}`;
  }
}
