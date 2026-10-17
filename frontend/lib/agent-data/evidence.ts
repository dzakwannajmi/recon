/**
 * The chat tool `get_evidence_bundle` (spec W4.7). It moves no money and returns no evidence: it only says
 * whether paid detail exists for an asset and where the user's browser can ask for it. The model never pays
 * and never sees the paid bundle (golden rules 1 and 3).
 *
 * Nothing under agent/ may reach lib/gateway or lib/payer (lib/gateway/guard.test.ts), so the switch is a
 * pure mirror of `paymentConfig(env).ok`. evidence.test.ts checks the two agree on a table of environments.
 */
import { StrKey } from "@stellar/stellar-sdk";
import type { StatusFile } from "../factsheet/load";

const TESTNET = "stellar:testnet";
const FACILITATOR_DEFAULT = "https://x402.org/facilitator";
const FACILITATOR_HOSTS = ["x402.org", "www.x402.org"];

type Env = Record<string, string | undefined>;
const unset = (v: string | undefined) => v === undefined || v.trim() === "";

/** True exactly when the paid detail route is switched on and configured (same rules as `paymentConfig(env).ok`). */
export function paidDetailAvailable(env: Env): boolean {
  if (!unset(env.PRICING_ENABLED) && env.PRICING_ENABLED !== "false") return false;
  if (env.X402_ENABLED !== "true") return false;
  if (!unset(env.X402_NETWORK) && env.X402_NETWORK !== TESTNET) return false;
  const payTo = (env.X402_PAY_TO ?? "").trim();
  if (payTo.startsWith("S") || !StrKey.isValidEd25519PublicKey(payTo)) return false;
  if (!/^[1-9][0-9]{0,11}$/.test((env.X402_TESTNET_AMOUNT ?? "").trim())) return false;
  const raw = unset(env.X402_FACILITATOR_URL) ? FACILITATOR_DEFAULT : (env.X402_FACILITATOR_URL as string).trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") return false;
  const allowed = [...FACILITATOR_HOSTS, ...(env.X402_FACILITATOR_ALLOW_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean)];
  return allowed.includes(url.hostname.toLowerCase());
}

export const PREMIUM_NOTE =
  "Premium evidence is a paid tool the user pays for with their own browser wallet (x402, Stellar testnet, test USDC). You cannot pay, you have not paid, and you do not receive the evidence. Tell the user the Unlock evidence card is below your answer.";

export type EvidenceOffer = {
  premium: true;
  available: boolean;
  detail_path: string | null;
  asset_code: string;
  issuer: string | null;
  note: string;
};

/** Pure: the offer for one asset from the stored status file and the paid switch. Never any evidence, never any amount. */
export function projectEvidenceOffer(status: StatusFile | null, code: string, issuer: string | undefined, paidAvailable: boolean): EvidenceOffer {
  const off = (note: string, found: string | null = null): EvidenceOffer => ({ premium: true, available: false, detail_path: null, asset_code: code, issuer: found, note });
  if (!paidAvailable) return off("Paid detail is not available on this server right now. The free tools (get_asset_status, get_verified_claims, check_asset) still work.");
  if (!status) return off("The stored status file could not be loaded, so paid detail cannot be offered.");
  const same = status.assets.filter((a) => a.asset_code === code);
  if (same.length === 0) return off(`${code} is not in the stored status file, so there is no paid detail for it.`);
  let hit = issuer ? same.find((a) => a.issuer === issuer) : undefined;
  if (issuer && !hit) return off(`${code} is in the stored status file, but not for that issuer.`);
  if (!issuer) {
    if (same.length > 1) return off(`More than one issuer is stored for ${code}. Ask the user which issuer, then call again with the issuer.`);
    hit = same[0];
  }
  const found = hit!;
  if (found.status === null || found.status === undefined) return off(`${code} has no published status yet, so there is no paid detail for it.`, found.issuer);
  const query = `asset_code=${encodeURIComponent(found.asset_code)}&issuer=${encodeURIComponent(found.issuer)}`;
  return { premium: true, available: true, detail_path: `/api/check/detail?${query}`, asset_code: found.asset_code, issuer: found.issuer, note: PREMIUM_NOTE };
}
