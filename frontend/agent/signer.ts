/**
 * THE AGENT'S SIGNING KEY (Stellar testnet), for the operator's feed publisher only.
 *
 * Only `scripts/publish-feed.ts` imports this file. Nothing under `app/` or the rest of `agent/` may
 * reach it (lib/feed/guard.test.ts enforces it), so the deployed web app never reads a secret and
 * AGENT_SECRET_KEY does not need to exist on Vercel.
 *
 * The key comes from AGENT_SECRET_KEY, else from the `secret` field of `.agent-wallet.json`. If the web
 * side has an address (AGENT_PUBLIC_KEY, or the file's `publicKey` field) and it differs from the loaded
 * key's public key, this throws, so a wrong key never signs silently. Nothing here returns the secret
 * as text, logs it, or echoes it in an error.
 */
import fs from "fs";
import { Keypair } from "@stellar/stellar-sdk";
import { getWalletAddress, walletFilePath } from "./wallet";

/** Errors whose messages are safe to print: they hold public keys and names, never a secret. */
export class SignerError extends Error {}

function loadSecretKeypair(): Keypair | null {
  const fromEnv = process.env.AGENT_SECRET_KEY?.trim();
  if (fromEnv) {
    try {
      return Keypair.fromSecret(fromEnv);
    } catch {
      throw new SignerError("AGENT_SECRET_KEY is not a valid Stellar secret key.");
    }
  }
  const file = walletFilePath();
  if (!fs.existsSync(file)) return null;
  try {
    return Keypair.fromSecret((JSON.parse(fs.readFileSync(file, "utf8")) as { secret: string }).secret);
  } catch {
    throw new SignerError("The wallet file has no valid secret key. Set AGENT_SECRET_KEY or recreate .agent-wallet.json.");
  }
}

/**
 * The signing keypair for `scripts/publish-feed.ts` (testnet), or null if none is configured.
 * Throws if the configured public address disagrees with the key. The caller must never print it.
 */
export function getAgentKeypair(): Keypair | null {
  const keypair = loadSecretKeypair();
  if (!keypair) return null;
  const expected = getWalletAddress();
  if (expected !== null && expected !== keypair.publicKey()) {
    throw new SignerError(
      `The signing key's public key ${keypair.publicKey()} does not match the configured wallet address ${expected} (AGENT_PUBLIC_KEY or the wallet file's publicKey).`,
    );
  }
  return keypair;
}
