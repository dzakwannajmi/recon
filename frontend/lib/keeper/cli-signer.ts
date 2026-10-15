/**
 * Signing through stellar-cli (D-045). This is the only keeper file that starts a process.
 * `stellar tx sign --sign-with-key <identity>` signs with a keystore or OS secure-store identity, so no
 * secret key ever enters Node: this file never asks stellar-cli for one and never reads a key file.
 *
 * The child runs with no shell and a minimal environment (`stellarChildEnv`). Its output is parsed and
 * checked, never echoed: an error message built here carries no child output (stdout, stderr or argv).
 * Testnet only (golden rule 6): `--network testnet` is part of every signing call.
 */
import { execFileSync } from "node:child_process";
import { Keypair, Networks, StrKey, Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
import { stellarChildEnv } from "../payer/env";

/** A stellar-cli identity name: lowercase letters, digits and hyphens. Anything else (a secret key, a seed phrase, a path) is refused. */
const IDENTITY = /^[a-z0-9-]{1,32}$/;

export const isIdentityName = (s: string): boolean => IDENTITY.test(s);

/** Runs `stellar` with the given argv and optional stdin; returns stdout. Tests pass a fake. */
export type StellarRunner = (args: readonly string[], input?: string) => string;

/** The real runner: `execFileSync`, no shell, stderr ignored, minimal environment. */
export const runStellar: StellarRunner = (args, input) =>
  execFileSync("stellar", [...args], {
    encoding: "utf8",
    input,
    stdio: ["pipe", "pipe", "ignore"],
    env: stellarChildEnv(process.env) as NodeJS.ProcessEnv,
    shell: false,
    timeout: 120_000,
    maxBuffer: 1024 * 1024,
  });

/** The exit status of a failed child, if it has one. Never the child's output. */
const statusOf = (err: unknown): string => {
  const s = typeof err === "object" && err !== null ? (err as { status?: unknown }).status : undefined;
  return typeof s === "number" ? ` (exit status ${s})` : "";
};

function assertIdentity(identity: string): void {
  if (!IDENTITY.test(identity)) throw new Error("The signer identity name is not valid: use lowercase letters, digits and hyphens only");
}

/** The public key (G...) of a stellar-cli identity. */
export function publicKeyOf(identity: string, run: StellarRunner = runStellar): string {
  assertIdentity(identity);
  let out: string;
  try {
    out = run(["keys", "public-key", identity]);
  } catch (err) {
    throw new Error(`stellar keys public-key failed for identity ${identity}${statusOf(err)}`);
  }
  const key = out.trim();
  if (!StrKey.isValidEd25519PublicKey(key)) throw new Error(`stellar keys public-key returned an invalid address for identity ${identity}`);
  return key;
}

/**
 * Sign `tx` with the identity and return the signed transaction. The envelope that comes back is checked:
 * it is a plain transaction with the same hash as the input, it has exactly one new signature, and that
 * signature verifies for `expectedG`. Anything else throws and nothing is sent.
 */
export function signWith(tx: Transaction, identity: string, expectedG: string, run: StellarRunner = runStellar): Transaction {
  assertIdentity(identity);
  if (!StrKey.isValidEd25519PublicKey(expectedG)) throw new Error("The expected signer is not an account address (G...)");
  let out: string;
  try {
    out = run(["tx", "sign", "--sign-with-key", identity, "--network", "testnet", "--quiet"], tx.toXDR());
  } catch (err) {
    throw new Error(`stellar tx sign failed for identity ${identity}${statusOf(err)}`);
  }
  let signed: Transaction;
  try {
    const parsed = TransactionBuilder.fromXDR(out.trim(), Networks.TESTNET);
    if (!(parsed instanceof Transaction)) throw new Error("not a plain transaction");
    signed = parsed;
  } catch {
    throw new Error("stellar tx sign returned something that is not a transaction envelope");
  }
  const before = tx.hash();
  if (!Buffer.from(signed.hash()).equals(Buffer.from(before))) throw new Error("The signed transaction has a different hash from the one sent for signing; refusing it");
  const known = new Set(tx.signatures.map((s) => Buffer.from(s.signature.toBytes()).toString("base64")));
  const added = signed.signatures.filter((s) => !known.has(Buffer.from(s.signature.toBytes()).toString("base64")));
  if (signed.signatures.length !== tx.signatures.length + 1 || added.length !== 1) {
    throw new Error("The signed transaction must carry exactly one new signature; refusing it");
  }
  const signer = Keypair.fromPublicKey(expectedG);
  const [sig] = added;
  if (!Buffer.from(sig.hint.toBytes()).equals(Buffer.from(signer.signatureHint())) || !signer.verify(Buffer.from(before), sig.signature.toBytes())) {
    throw new Error(`The new signature does not verify for ${expectedG}; refusing it`);
  }
  return signed;
}
