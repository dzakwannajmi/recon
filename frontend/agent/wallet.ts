/**
 * THE AGENT'S WALLET (Stellar testnet)
 *
 * The agent owns a Stellar keypair. It is pinned to testnet and funded by
 * Friendbot, so no real money is ever involved. Mainnet reads (W1.3+) use a
 * separate read-only client, never this module.
 *
 * The secret key is read from AGENT_SECRET_KEY, or created with the
 * "Create wallet" button and saved in `.agent-wallet.json` (git-ignored).
 * The secret never leaves this file: nothing here returns or logs it,
 * and error messages never echo it.
 */
import fs from "fs";
import path from "path";
import { Horizon, Keypair, NotFoundError } from "@stellar/stellar-sdk";

const WALLET_FILE = path.join(process.cwd(), ".agent-wallet.json");
const TESTNET_HORIZON_URL = "https://horizon-testnet.stellar.org";
const FRIENDBOT_URL = "https://friendbot.stellar.org";
const FRIENDBOT_TIMEOUT_MS = 15_000;
const horizon = new Horizon.Server(TESTNET_HORIZON_URL);

export const NETWORK = "Stellar testnet";

/** Errors whose messages are safe to show to the user and the model. */
export class WalletError extends Error {}

function loadKeypair(): Keypair | null {
  if (process.env.AGENT_SECRET_KEY) {
    try {
      return Keypair.fromSecret(process.env.AGENT_SECRET_KEY);
    } catch {
      throw new WalletError("AGENT_SECRET_KEY is not a valid Stellar secret key.");
    }
  }
  if (!fs.existsSync(WALLET_FILE)) return null;
  try {
    return Keypair.fromSecret(JSON.parse(fs.readFileSync(WALLET_FILE, "utf8")).secret);
  } catch {
    throw new WalletError("The wallet file is unreadable. Delete .agent-wallet.json and create a new wallet.");
  }
}

function requireKeypair() {
  const keypair = loadKeypair();
  if (!keypair) throw new WalletError("The agent has no wallet yet. Ask the user to click 'Create wallet' first.");
  return keypair;
}

/**
 * The signing keypair, for the feed publisher script only (`scripts/publish-feed.ts`, testnet).
 * Nothing under `agent/` or `app/` may call this (a test enforces it). The caller must never print it.
 */
export function getAgentKeypair(): Keypair | null {
  return loadKeypair();
}

export function getWalletAddress() {
  return loadKeypair()?.publicKey() ?? null;
}

export function explorerUrl(address: string) {
  return `https://stellar.expert/explorer/testnet/account/${address}`;
}

/** Ask Friendbot to fund the account on testnet. Safe to call twice. */
export async function fundWallet() {
  const address = requireKeypair().publicKey();
  const res = await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(address)}`, {
    signal: AbortSignal.timeout(FRIENDBOT_TIMEOUT_MS),
  });
  if (res.ok) return { funded: true, address };
  const body = await res.text();
  if (body.includes("createAccountAlreadyExist")) return { funded: false, address, note: "Already funded." };
  throw new WalletError(`Friendbot failed with status ${res.status}.`);
}

/** Make a new keypair, save it (never overwriting an existing one), and fund it with Friendbot. */
export async function createWallet() {
  const existing = getWalletAddress();
  if (existing) return existing;
  const keypair = Keypair.random();
  try {
    fs.writeFileSync(WALLET_FILE, JSON.stringify({ publicKey: keypair.publicKey(), secret: keypair.secret() }, null, 2), {
      mode: 0o600,
      flag: "wx",
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return requireKeypair().publicKey();
    throw new WalletError("Could not save the wallet file.");
  }
  await fundWallet();
  return keypair.publicKey();
}

/** Balances as readable strings, e.g. ["10000.0000000 XLM"]. */
export async function getWalletBalances() {
  const address = requireKeypair().publicKey();
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
