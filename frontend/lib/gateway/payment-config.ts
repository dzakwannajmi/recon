/**
 * Configuration of the paid detail route (spec 4.1). Pure: `paymentConfig(env)` reads nothing
 * but the object it is given. Any failure gives `ok:false` with a fixed reason name; a value
 * (and above all the amount, the receiving address, or a secret) is never echoed or logged.
 *
 * Testnet only (golden rule 6): the network, the asset, and the facilitator host are pinned.
 * `PRICING_ENABLED=true` closes the route, it never opens it (golden rule 7; decision D-041).
 */
import { StrKey } from "@stellar/stellar-sdk";
import { ExactStellarScheme } from "@x402/stellar/exact/server";

export const NETWORK = "stellar:testnet" as const;
/** The testnet USDC Stellar Asset Contract (7 decimals), pinned. */
export const USDC_TESTNET_SAC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
export const DEFAULT_FACILITATOR_URL = "https://x402.org/facilitator";
export const FACILITATOR_HOSTS: readonly string[] = ["x402.org", "www.x402.org"];

export const MAX_TIMEOUT_SECONDS = 60;
export const FACILITATOR_TIMEOUT_MS = 80_000;
export const MAX_PAYMENT_HEADER_BYTES = 16_384;

export type PaymentConfig = {
  payTo: string;
  /** USDC base units (7 decimals), from the environment only. */
  amount: string;
  facilitatorUrl: string;
};

export type ConfigReason =
  | "pricing_enabled_not_supported"
  | "disabled"
  | "network_not_testnet"
  | "asset_constant_mismatch"
  | "pay_to_is_secret"
  | "pay_to_invalid"
  | "amount_invalid"
  | "facilitator_url_invalid"
  | "facilitator_host_not_allowed";

export type ConfigResult = { ok: true; config: PaymentConfig } | { ok: false; reason: ConfigReason };

export type Env = Record<string, string | undefined>;

const unset = (v: string | undefined) => v === undefined || v.trim() === "";

/**
 * The installed x402 package must still know the pinned address as its testnet USDC (7 decimals):
 * a package update cannot silently switch the asset.
 */
export function pinnedAssetMatchesPackage(): boolean {
  return new ExactStellarScheme().getAssetDecimals(USDC_TESTNET_SAC, NETWORK) === 7;
}

export function paymentConfig(env: Env, assetMatches: () => boolean = pinnedAssetMatchesPackage): ConfigResult {
  const fail = (reason: ConfigReason): ConfigResult => ({ ok: false, reason });

  if (!unset(env.PRICING_ENABLED) && env.PRICING_ENABLED !== "false") return fail("pricing_enabled_not_supported");
  if (env.X402_ENABLED !== "true") return fail("disabled");
  if (!unset(env.X402_NETWORK) && env.X402_NETWORK !== NETWORK) return fail("network_not_testnet");
  if (!assetMatches()) return fail("asset_constant_mismatch");

  const payTo = (env.X402_PAY_TO ?? "").trim();
  if (payTo.startsWith("S")) return fail("pay_to_is_secret");
  if (!StrKey.isValidEd25519PublicKey(payTo)) return fail("pay_to_invalid");

  const amount = (env.X402_TESTNET_AMOUNT ?? "").trim();
  if (!/^[1-9][0-9]{0,11}$/.test(amount)) return fail("amount_invalid");

  const rawUrl = unset(env.X402_FACILITATOR_URL) ? DEFAULT_FACILITATOR_URL : (env.X402_FACILITATOR_URL as string).trim();
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return fail("facilitator_url_invalid");
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") return fail("facilitator_url_invalid");
  const allowed = [...FACILITATOR_HOSTS, ...(env.X402_FACILITATOR_ALLOW_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean)];
  if (!allowed.includes(url.hostname.toLowerCase())) return fail("facilitator_host_not_allowed");

  return { ok: true, config: { payTo, amount, facilitatorUrl: rawUrl.replace(/\/+$/, "") } };
}
