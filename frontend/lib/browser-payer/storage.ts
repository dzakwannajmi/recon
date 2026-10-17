/**
 * The burner payer wallet (spec W4.7). A testnet keypair made in the browser and kept in localStorage.
 * The secret never leaves the browser: no helper here puts it in a request, a URL, a log, or the page.
 * Every storage access is wrapped: blocked storage (private mode, policy) just means "no wallet kept".
 */
import { Keypair, StrKey, type Transaction } from "@stellar/stellar-sdk";
import { createEd25519Signer } from "@x402/stellar";
import type { ClientStellarSigner } from "@x402/stellar";
import { NETWORK, STORAGE_KEY, UNKNOWN_KEY } from "./constants";

export type KeyStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * What the payer needs from a key. A burner implements it today; a browser extension wallet (Freighter)
 * can implement it later without changing the payment code.
 */
export interface PayerKey {
  readonly address: string;
  /** The signer the x402 client scheme uses for the Soroban authorization. */
  x402Signer(): ClientStellarSigner;
  /** Signs a classic transaction in place (the trustline). */
  signTransaction(tx: Transaction): void;
}

export function burnerKey(secret: string): PayerKey {
  const kp = Keypair.fromSecret(secret);
  return {
    address: kp.publicKey(),
    x402Signer: () => createEd25519Signer(secret, NETWORK),
    signTransaction: (tx) => tx.sign(kp),
  };
}

/** The store of this browser, or null when storage is blocked. */
export function browserStore(): KeyStore | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** The kept secret, or null when there is none, it is not a valid secret seed, or storage is blocked. */
export function loadSecret(store: KeyStore | null): string | null {
  try {
    const v = store?.getItem(STORAGE_KEY);
    return typeof v === "string" && StrKey.isValidEd25519SecretSeed(v) ? v : null;
  } catch {
    return null;
  }
}

/** Makes a new burner key and tries to keep it. `kept` is false when storage is blocked (the key then lives until the page closes). */
export function createBurner(store: KeyStore | null, random: () => Keypair = () => Keypair.random()): { seed: string; kept: boolean } {
  const seed = random().secret();
  try {
    if (!store) return { seed, kept: false };
    store.setItem(STORAGE_KEY, seed);
    return { seed, kept: store.getItem(STORAGE_KEY) === seed };
  } catch {
    return { seed, kept: false };
  }
}

export function forgetSecret(store: KeyStore | null): void {
  try {
    store?.removeItem(STORAGE_KEY);
  } catch {
    // nothing kept, or storage blocked: nothing to forget
  }
}

/**
 * The "payment outcome unknown" marker. Shared by every card, kept across reloads, and NOT removed by "Forget wallet":
 * only the user's "I checked the explorer" clears it. It holds the settlement transaction hash when there was one.
 */
export type UnknownMarker = { tx: string | null };

export function loadUnknown(store: KeyStore | null): UnknownMarker | null {
  try {
    const v = store?.getItem(UNKNOWN_KEY);
    if (v === "unknown") return { tx: null };
    const m = typeof v === "string" ? /^unknown:([0-9a-f]{64})$/i.exec(v) : null;
    return m ? { tx: m[1] } : null;
  } catch {
    return null;
  }
}

export function saveUnknown(store: KeyStore | null, marker: UnknownMarker): void {
  try {
    store?.setItem(UNKNOWN_KEY, marker.tx ? `unknown:${marker.tx}` : "unknown");
  } catch {
    // storage blocked: the marker then lives in this card's memory only
  }
}

export function clearUnknown(store: KeyStore | null): void {
  try {
    store?.removeItem(UNKNOWN_KEY);
  } catch {
    // nothing kept, or storage blocked
  }
}
