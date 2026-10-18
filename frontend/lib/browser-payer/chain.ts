/**
 * Testnet reads and writes for the burner wallet. Network calls take an injected `fetch`, so tests run offline.
 * Only public addresses and signed transactions leave the browser; messages shown are fixed words written here.
 */
import { Account, Asset, BASE_FEE, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { DECIMALS, FRIENDBOT, HORIZON_TESTNET, NETWORK_PASSPHRASE, USDC_CODE, USDC_TESTNET_ISSUER } from "./constants";
import type { PayerKey } from "./storage";

type Fetch = typeof fetch;

/** What the wallet holds: test XLM and test USDC in base units (testnet only, no value). */
export type Snapshot = { funded: boolean; trustline: boolean; usdcBase: bigint; xlmBase: bigint };

/** Base units to a short decimal text: `"19999.97"`. Trailing zeros are dropped, at most `places` decimals kept. */
export function formatBase(base: bigint, places = 2): string {
  const unit = 10n ** BigInt(DECIMALS);
  const whole = base / unit;
  const frac = (base % unit).toString().padStart(DECIMALS, "0").slice(0, places).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

export type WalletState = "missing" | "not_funded" | "no_trustline" | "no_usdc" | "ready";

/** `"12.3456789"` to base units, exactly; anything else is 0. */
export function decimalToBase(text: unknown): bigint {
  const m = typeof text === "string" ? /^(\d+)(?:\.(\d{1,7}))?$/.exec(text) : null;
  return m ? BigInt(m[1]) * 10n ** BigInt(DECIMALS) + BigInt((m[2] ?? "").padEnd(DECIMALS, "0")) : 0n;
}

/** The snapshot from a Horizon account body; `null` body means the account does not exist. */
export function snapshotOf(body: unknown): Snapshot {
  if (body === null || typeof body !== "object") return { funded: false, trustline: false, usdcBase: 0n, xlmBase: 0n };
  const balances = (body as { balances?: unknown }).balances;
  const list = Array.isArray(balances) ? balances : [];
  const usdc = list.find((b) => b && b.asset_code === USDC_CODE && b.asset_issuer === USDC_TESTNET_ISSUER);
  const xlm = list.find((b) => b && b.asset_type === "native");
  return { funded: true, trustline: Boolean(usdc), usdcBase: usdc ? decimalToBase(usdc.balance) : 0n, xlmBase: xlm ? decimalToBase(xlm.balance) : 0n };
}

export function walletState(hasWallet: boolean, snap: Snapshot | null): WalletState {
  if (!hasWallet) return "missing";
  if (!snap || !snap.funded) return "not_funded";
  if (!snap.trustline) return "no_trustline";
  if (snap.usdcBase <= 0n) return "no_usdc";
  return "ready";
}

export async function readSnapshot(address: string, fetchFn: Fetch): Promise<Snapshot | "unreadable"> {
  try {
    const res = await fetchFn(`${HORIZON_TESTNET}/accounts/${address}`);
    if (res.status === 404) return snapshotOf(null);
    if (!res.ok) return "unreadable";
    return snapshotOf(await res.json());
  } catch {
    return "unreadable";
  }
}

export type Step = { ok: true } | { ok: false; message: string };

export async function friendbot(address: string, fetchFn: Fetch): Promise<Step> {
  try {
    const res = await fetchFn(`${FRIENDBOT}?addr=${encodeURIComponent(address)}`);
    return res.ok ? { ok: true } : { ok: false, message: "Friendbot did not fund the account. It may already be funded; try again in a moment." };
  } catch {
    return { ok: false, message: "Could not reach Friendbot." };
  }
}

/** Builds, signs in the browser, and submits a changeTrust for the testnet USDC. */
export async function addTrustline(key: PayerKey, fetchFn: Fetch): Promise<Step> {
  try {
    const acc = await fetchFn(`${HORIZON_TESTNET}/accounts/${key.address}`);
    if (!acc.ok) return { ok: false, message: "The account is not funded yet." };
    const sequence = (await acc.json()).sequence;
    if (typeof sequence !== "string") return { ok: false, message: "Could not read the account." };
    const tx = new TransactionBuilder(new Account(key.address, sequence), { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
      .addOperation(Operation.changeTrust({ asset: new Asset(USDC_CODE, USDC_TESTNET_ISSUER) }))
      .setTimeout(60)
      .build();
    key.signTransaction(tx);
    const res = await fetchFn(`${HORIZON_TESTNET}/transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ tx: tx.toXDR() }).toString(),
    });
    return res.ok ? { ok: true } : { ok: false, message: "The trustline transaction was not accepted." };
  } catch {
    return { ok: false, message: "Could not add the trustline." };
  }
}
