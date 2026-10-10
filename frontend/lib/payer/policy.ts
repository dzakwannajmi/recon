/**
 * Client-side rules of the demo payer (spec 8.2). Pure functions: no network, no keys, no clock.
 * The CLI refuses anything that is not exactly the testnet payment it was set up for, so a rogue or
 * mistaken server cannot make it pay more, elsewhere, or on mainnet (golden rules 6 and 8).
 *
 * Nothing under agent/ or app/ may import this folder (guard test lib/gateway/guard.test.ts).
 */
import type { PaymentPolicy } from "@x402/core/client";
import type { PaymentRequirements } from "@x402/core/types";
import { NETWORK, USDC_TESTNET_SAC } from "../gateway/payment-config";

export const USDC_TESTNET_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
export const USDC_CODE = "USDC";
export const DECIMALS = 7;

export type Expected = {
  /** The receiving account from the operator's environment. */
  payTo: string;
  /** The most the operator allows per payment, in USDC base units. */
  capBase: bigint;
};

/** `"12.3456789"` to base units, exactly. Anything that is not a plain decimal with up to 7 places is refused. */
export function decimalToBase(text: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,7}))?$/.exec(text);
  if (!m) throw new Error("not a decimal amount with at most 7 places");
  return BigInt(m[1]) * 10n ** BigInt(DECIMALS) + BigInt((m[2] ?? "").padEnd(DECIMALS, "0"));
}

/** Base units to a 7-place decimal string, exactly. */
export function baseToDecimal(units: bigint): string {
  if (units < 0n) throw new Error("negative amount");
  const s = units.toString().padStart(DECIMALS + 1, "0");
  return `${s.slice(0, -DECIMALS)}.${s.slice(-DECIMALS)}`;
}

/** Why a requirement is refused, or null when it is exactly the expected testnet payment. Never repeats an amount. */
export function refuseReason(x402Version: number, r: PaymentRequirements, e: Expected): string | null {
  if (x402Version !== 2) return "not x402 version 2";
  if (r.scheme !== "exact") return "scheme is not exact";
  if (r.network !== NETWORK) return "network is not stellar:testnet";
  if (r.asset !== USDC_TESTNET_SAC) return "asset is not the testnet USDC contract";
  if (r.payTo !== e.payTo) return "payTo is not the expected account";
  if (r.extra?.areFeesSponsored !== true) return "the facilitator does not sponsor fees";
  if (typeof r.amount !== "string" || !/^[1-9][0-9]{0,18}$/.test(r.amount)) return "amount is not a positive integer of base units";
  if (BigInt(r.amount) > e.capBase) return "amount is above the cap set in the environment";
  return null;
}

/** For `x402Client.registerPolicy`: keeps only the requirements `refuseReason` accepts. */
export const acceptRequirements =
  (e: Expected): PaymentPolicy =>
  (x402Version, requirements) =>
    requirements.filter((r) => refuseReason(x402Version, r, e) === null);

/** The payer must not be a key Recon uses for anything else, nor the receiver. Returns the reason, or null. */
export function refusePayer(p: { payer: string; publisher: string; admin: string; payTo: string }): string | null {
  if (p.payer === p.publisher) return "the payer is the feed publisher account";
  if (p.payer === p.admin) return "the payer is the feed admin account";
  if (p.payer === p.payTo) return "the payer is the receiving account";
  return null;
}
