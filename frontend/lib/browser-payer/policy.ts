/**
 * What the browser agrees to sign. Pure. The browser pays only a plain testnet payment: x402 v2, exact, stellar:testnet,
 * the pinned testnet USDC contract, fees sponsored, and never more than the payer's own test USDC balance.
 * Reasons are fixed words written here; a server's text is never shown.
 */
import type { PaymentPolicy } from "@x402/core/client";
import type { PaymentRequirements } from "@x402/core/types";
import { NETWORK, USDC_TESTNET_SAC } from "./constants";

export function refuseReason(x402Version: number, r: PaymentRequirements, balanceBase: bigint): string | null {
  if (x402Version !== 2) return "not x402 version 2";
  if (r.scheme !== "exact") return "scheme is not exact";
  if (r.network !== NETWORK) return "network is not stellar:testnet";
  if (r.asset !== USDC_TESTNET_SAC) return "asset is not the testnet USDC contract";
  if (r.extra?.areFeesSponsored !== true) return "the facilitator does not sponsor fees";
  if (typeof r.amount !== "string" || !/^[1-9][0-9]{0,18}$/.test(r.amount)) return "amount is not a positive integer of base units";
  if (BigInt(r.amount) > balanceBase) return "the test USDC balance is not sufficient";
  return null;
}

export const acceptRequirements =
  (balanceBase: bigint): PaymentPolicy =>
  (x402Version, requirements) =>
    requirements.filter((r) => refuseReason(x402Version, r, balanceBase) === null);
