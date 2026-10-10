/**
 * Command-line arguments of `npm run check:paid` (spec 8.2). Pure: no network, no environment.
 */
import { StrKey } from "@stellar/stellar-sdk";

export const USAGE = `Usage: npm run check:paid -- --asset CODE [--issuer G...] [--base-url URL] [--replay-check]

Pays for one detail response with x402 on Stellar testnet (test USDC, no value) and confirms the
transfer on Horizon testnet. Testnet only; it never prints a secret key, a balance, or an amount.

Options:
  --asset CODE        Asset code (letters and digits, up to 12 characters). Required.
  --issuer G...       Issuer account, when the code has more than one tracked issuer.
  --base-url URL      Server to call: http://localhost:PORT, http://127.0.0.1:PORT, or https://... (default http://localhost:3000).
  --replay-check      After the payment, send the same payment again and confirm it is refused and no second transfer appears.
  --help              Show this text.

No .env file is loaded. Configuration comes from these flags and from the process environment only,
so set the values inline on the command line (this script does not store or print them; your shell history may keep them). stellar-cli, which holds
the payer key, is started with a minimal environment.

Environment:
  X402_PAY_TO           The receiving account (G...). Required.
  X402_TESTNET_AMOUNT   The most this run may pay, in USDC base units. Required.
  X402_PAYER_IDENTITY   stellar-cli identity name of the payer (default x402-payer).

Exit codes: 0 done, 1 refused before paying, 2 possibly paid (no response, or a check could not finish), 3 not settled or contradicted by the chain.
`;

export type CliArgs = { asset: string; issuer?: string; baseUrl: string; replayCheck: boolean };
export type ParsedArgs = { kind: "help" } | { kind: "run"; args: CliArgs } | { kind: "error"; message: string };

export const DEFAULT_BASE_URL = "http://localhost:3000";

/** The base URL when it is allowed: http only for localhost or 127.0.0.1, https for any host, no credentials, no query. */
export function validateBaseUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) return null;
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol === "http:" ? !local : url.protocol !== "https:") return null;
  return url.origin + url.pathname.replace(/\/+$/, "");
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  let asset: string | undefined;
  let issuer: string | undefined;
  let baseUrl = DEFAULT_BASE_URL;
  let replayCheck = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new Error(`${a} needs a value`);
      return v;
    };
    try {
      if (a === "--help" || a === "-h") return { kind: "help" };
      else if (a === "--asset") asset = value();
      else if (a === "--issuer") issuer = value();
      else if (a === "--base-url") baseUrl = value();
      else if (a === "--replay-check") replayCheck = true;
      else return { kind: "error", message: `Unknown argument: ${a.slice(0, 40)}` };
    } catch (e) {
      return { kind: "error", message: (e as Error).message };
    }
  }
  if (!asset || !/^[A-Za-z0-9]{1,12}$/.test(asset)) return { kind: "error", message: "--asset CODE is required (letters and digits, up to 12 characters)" };
  if (issuer !== undefined && !StrKey.isValidEd25519PublicKey(issuer)) return { kind: "error", message: "--issuer must be a valid Stellar account address (G...)" };
  const base = validateBaseUrl(baseUrl);
  if (!base) return { kind: "error", message: "--base-url must be http://localhost:PORT, http://127.0.0.1:PORT, or https://..." };
  return { kind: "run", args: { asset, ...(issuer ? { issuer } : {}), baseUrl: base, replayCheck } };
}
