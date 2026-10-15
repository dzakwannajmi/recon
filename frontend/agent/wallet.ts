/**
 * THE AGENT'S WALLET (Stellar testnet), public side only
 *
 * The agent owns a Stellar keypair. It is pinned to testnet and funded by
 * Friendbot, so no real money is ever involved. Mainnet reads (W1.3+) use a
 * separate read-only client, never this module.
 *
 * The web app (chat tools, /api/wallet) needs only the address. It comes from
 * AGENT_PUBLIC_KEY, else from the `publicKey` field of `.agent-wallet.json`
 * (git-ignored). This module never loads a signing key and never reads the
 * file's private field. Signing lives in `agent/signer.ts`, which only the
 * operator script `scripts/publish-feed.ts` imports (guard tests enforce both).
 *
 * The "Create wallet" button (local development) may still generate a keypair
 * and save it to the git-ignored file. That path writes a fresh keypair once,
 * never returns or logs its private half, and refuses when AGENT_PUBLIC_KEY is set.
 */
import fs from "fs";
import path from "path";
import { Horizon, Keypair, NotFoundError, StrKey } from "@stellar/stellar-sdk";

const TESTNET_HORIZON_URL = "https://horizon-testnet.stellar.org";
const FRIENDBOT_URL = "https://friendbot.stellar.org";
const FRIENDBOT_TIMEOUT_MS = 15_000;
const horizon = new Horizon.Server(TESTNET_HORIZON_URL);

export const NETWORK = "Stellar testnet";

/** Errors whose messages are safe to show to the user and the model. */
export class WalletError extends Error {}

/** The git-ignored wallet file, resolved per call so tests can point the working directory elsewhere. */
export function walletFilePath() {
  return path.join(process.cwd(), ".agent-wallet.json");
}

/** AGENT_PUBLIC_KEY if set (validated), else null. */
export function configuredPublicKey(): string | null {
  const value = process.env.AGENT_PUBLIC_KEY?.trim();
  if (!value) return null;
  if (!StrKey.isValidEd25519PublicKey(value)) {
    throw new WalletError("AGENT_PUBLIC_KEY is not a valid Stellar public key (G...).");
  }
  return value;
}

/** The `publicKey` field of the wallet file, or null if there is no file. Reads no other field. */
function filePublicKey(): string | null {
  const file = walletFilePath();
  if (!fs.existsSync(file)) return null;
  let publicKey: unknown;
  try {
    publicKey = (JSON.parse(fs.readFileSync(file, "utf8")) as { publicKey?: unknown }).publicKey;
  } catch {
    throw new WalletError("The wallet file is unreadable. Delete .agent-wallet.json and create a new wallet.");
  }
  if (typeof publicKey !== "string" || !StrKey.isValidEd25519PublicKey(publicKey)) {
    throw new WalletError("The wallet file has no valid public key. Delete .agent-wallet.json and create a new wallet.");
  }
  return publicKey;
}

function requireAddress() {
  const address = getWalletAddress();
  if (!address) throw new WalletError("The agent has no wallet yet. Ask the user to click 'Create wallet' first.");
  return address;
}

/** The agent wallet's public address: AGENT_PUBLIC_KEY, else the wallet file's public key, else null. */
export function getWalletAddress(): string | null {
  return configuredPublicKey() ?? filePublicKey();
}

export function explorerUrl(address: string) {
  return `https://stellar.expert/explorer/testnet/account/${address}`;
}

/** Ask Friendbot to fund the account on testnet. Safe to call twice. */
export async function fundWallet() {
  const address = requireAddress();
  const res = await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(address)}`, {
    signal: AbortSignal.timeout(FRIENDBOT_TIMEOUT_MS),
  });
  if (res.ok) return { funded: true, address };
  const body = await res.text();
  if (body.includes("createAccountAlreadyExist")) return { funded: false, address, note: "Already funded." };
  throw new WalletError(`Friendbot failed with status ${res.status}.`);
}

/**
 * Local development only: make a new keypair, save it (never overwriting an existing file), and fund it
 * with Friendbot. Returns the public address only. Refuses when AGENT_PUBLIC_KEY configures the wallet.
 */
export async function createWallet() {
  if (configuredPublicKey()) {
    throw new WalletError("The wallet is set by AGENT_PUBLIC_KEY, so the app cannot create one. Unset it to create a local wallet.");
  }
  const existing = filePublicKey();
  if (existing) return existing;
  const keypair = Keypair.random();
  try {
    fs.writeFileSync(walletFilePath(), JSON.stringify({ publicKey: keypair.publicKey(), secret: keypair.secret() }, null, 2), {
      mode: 0o600,
      flag: "wx",
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return requireAddress();
    throw new WalletError("Could not save the wallet file.");
  }
  await fundWallet();
  return keypair.publicKey();
}

/** Balances as readable strings, e.g. ["10000.0000000 XLM"]. */
export async function getWalletBalances() {
  const address = requireAddress();
  try {
    const account = await horizon.loadAccount(address);
    return account.balances.map((b) =>
      b.asset_type === "native"
        ? `${b.balance} XLM`
        : `${b.balance} ${"asset_code" in b ? b.asset_code : b.asset_type}`,
    );
  } catch (err) {
    if (err instanceof NotFoundError) return ["Not funded yet"];
    throw err;
  }
}
