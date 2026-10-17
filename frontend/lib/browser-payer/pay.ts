/**
 * The x402 flow in the browser against the same origin (spec W4.7). It pays at most once per call and never retries:
 * what happens after the paid request is sent is "paid" (a settled 200 with a transaction hash) or "unknown".
 * The returned bundle goes to the caller for display only. Messages are fixed words written here, never server text,
 * and nothing here logs. The secret stays inside the signer.
 */
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { ExactStellarScheme } from "@x402/stellar/exact/client";
import { NETWORK } from "./constants";
import { acceptRequirements, refuseReason } from "./policy";
import type { PayOutcome } from "./state";
import type { PayerKey } from "./storage";

export const PAID_TIMEOUT_MS = 120_000;
const TX_HASH = /^[0-9a-f]{64}$/i;

const failed = (message: string): PayOutcome => ({ kind: "failed", message });

/** The relative detail URL, rebuilt from a validated code and issuer; never taken from a model or server string. */
export function detailUrl(assetCode: string, issuer: string): string | null {
  if (!/^[A-Za-z0-9]{1,12}$/.test(assetCode) || !/^G[A-Z2-7]{55}$/.test(issuer)) return null;
  return `/api/check/detail?asset_code=${encodeURIComponent(assetCode)}&issuer=${encodeURIComponent(issuer)}`;
}

export type PayInput = { url: string; key: PayerKey; balanceBase: bigint; fetchFn: typeof fetch };

export async function payForDetail({ url, key, balanceBase, fetchFn }: PayInput): Promise<PayOutcome> {
  // Everything before the paid request is sent can fail without any money moving.
  let http: x402HTTPClient;
  let signature: Record<string, string>;
  try {
    const client = new x402Client();
    client.register(NETWORK, new ExactStellarScheme(key.x402Signer()));
    client.registerPolicy(acceptRequirements(balanceBase));
    http = new x402HTTPClient(client);

    const unpaid = await fetchFn(url, { signal: AbortSignal.timeout(30_000) });
    if (unpaid.status !== 402) return failed("The server did not ask for a payment. Paid detail may be switched off.");
    const unpaidBody = await unpaid.json().catch(() => undefined);
    const required = http.getPaymentRequiredResponse((n) => unpaid.headers.get(n), unpaidBody);
    const reasons = required.accepts.map((r) => refuseReason(required.x402Version, r, balanceBase));
    if (!reasons.some((r) => r === null)) {
      return failed(reasons.includes("the test USDC balance is not sufficient") ? "The test USDC balance is not sufficient." : "The payment requirements are not a plain Stellar testnet payment, so nothing was signed.");
    }
    const payload = await http.createPaymentPayload(required);
    signature = http.encodePaymentSignatureHeader(payload);
  } catch {
    return failed("Could not prepare the payment. Nothing was paid.");
  }

  // The one paid request. From here on, no failure is "nothing was paid".
  let res: Response;
  try {
    res = await fetchFn(url, { headers: signature, signal: AbortSignal.timeout(PAID_TIMEOUT_MS) });
  } catch {
    return { kind: "unknown", tx: null };
  }
  let tx: string | null = null;
  try {
    const settle = http.getPaymentSettleResponse((n) => res.headers.get(n));
    tx = settle.success && typeof settle.transaction === "string" && TX_HASH.test(settle.transaction) ? settle.transaction : null;
  } catch {
    tx = null;
  }
  if (res.status !== 200 || !tx) return { kind: "unknown", tx };
  try {
    return { kind: "paid", tx, body: await res.json() };
  } catch {
    return { kind: "unknown", tx };
  }
}
