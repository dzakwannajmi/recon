/**
 * Confirm a settlement on Horizon testnet (spec 8.2, steps 9 and 10). Pure: it takes parsed Horizon
 * JSON and decides. The CLI never trusts the server's or the facilitator's word that a payment happened.
 */
import { USDC_CODE, USDC_TESTNET_ISSUER, decimalToBase } from "./policy";

export type BalanceChange = {
  asset_type?: string;
  asset_code?: string;
  asset_issuer?: string;
  type?: string;
  from?: string;
  to?: string;
  amount?: string;
};

export type HorizonOperation = {
  type?: string;
  /** For an x402 settlement this is the facilitator, not the payer. */
  source_account?: string;
  transaction_hash?: string;
  transaction_successful?: boolean;
  created_at?: string;
  asset_balance_changes?: BalanceChange[];
};

export type HorizonTransaction = { hash?: string; successful?: boolean; ledger?: number; created_at?: string };

/** The testnet USDC transfers an operation list reports (credit_alphanum4 USDC from the pinned issuer, type transfer). */
export function usdcTransfers(ops: readonly HorizonOperation[]): BalanceChange[] {
  return ops.flatMap((op) =>
    (op.asset_balance_changes ?? []).filter(
      (c) => c.type === "transfer" && c.asset_type === "credit_alphanum4" && c.asset_code === USDC_CODE && c.asset_issuer === USDC_TESTNET_ISSUER,
    ),
  );
}

export type Confirmation = { ok: true; ledger: number } | { ok: false; reason: string };

/**
 * The transaction succeeded and holds exactly one testnet USDC transfer, from the payer to the receiver,
 * for exactly the amount of the requirement. Reasons never repeat an amount.
 */
export function confirmTransfer(
  tx: HorizonTransaction,
  ops: readonly HorizonOperation[],
  expected: { txHash: string; payer: string; payTo: string; amountBase: bigint },
): Confirmation {
  if (tx.hash !== expected.txHash) return { ok: false, reason: "the transaction is not the one that was reported" };
  if (tx.successful !== true) return { ok: false, reason: "the transaction did not succeed" };
  if (typeof tx.ledger !== "number") return { ok: false, reason: "the transaction has no ledger" };
  if (ops.some((op) => op.transaction_successful === false)) return { ok: false, reason: "an operation did not succeed" };
  const transfers = usdcTransfers(ops);
  if (transfers.length !== 1) return { ok: false, reason: transfers.length === 0 ? "no USDC transfer in the transaction" : "more than one USDC transfer in the transaction" };
  const t = transfers[0];
  if (t.from !== expected.payer) return { ok: false, reason: "the transfer is not from the payer" };
  if (t.to !== expected.payTo) return { ok: false, reason: "the transfer is not to the receiving account" };
  let amount: bigint;
  try {
    amount = decimalToBase(String(t.amount));
  } catch {
    return { ok: false, reason: "the transfer amount is not readable" };
  }
  if (amount !== expected.amountBase) return { ok: false, reason: "the transfer amount is not the required amount" };
  return { ok: true, ledger: tx.ledger };
}

/**
 * The distinct transactions with a successful payer-to-receiver USDC transfer made at or after `since`
 * (for the case where the response never arrived, and for the replay check). Order follows the input.
 */
export function paymentsSince(ops: readonly HorizonOperation[], match: { payer: string; payTo: string; since: Date }): string[] {
  const hashes: string[] = [];
  for (const op of ops) {
    if (op.transaction_successful === false || !op.transaction_hash || !op.created_at) continue;
    if (Date.parse(op.created_at) < match.since.getTime()) continue;
    if (!usdcTransfers([op]).some((t) => t.from === match.payer && t.to === match.payTo)) continue;
    if (!hashes.includes(op.transaction_hash)) hashes.push(op.transaction_hash);
  }
  return hashes;
}
