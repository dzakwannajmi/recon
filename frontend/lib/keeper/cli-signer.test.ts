import { execFileSync } from "node:child_process";
import { Account, Contract, Networks, Transaction, TransactionBuilder, type Keypair } from "@stellar/stellar-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { stellarChildEnv } from "../payer/env";
import { buildTx } from "../feed/reader";
import { isIdentityName, publicKeyOf, runStellar, signWith, type StellarRunner } from "./cli-signer";
import { IDS, KEYPAIRS, KEYS } from "./testkit";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));

const txOf = (seq = "10", source: string = KEYS.keeper) => buildTx(new Contract(IDS.liveMarket), new Account(source, seq), "sync", []);
const signedBy = (tx: Transaction, kp: Keypair) => {
  const copy = TransactionBuilder.fromXDR(tx.toXDR(), Networks.TESTNET) as Transaction;
  copy.sign(kp);
  return copy.toXDR();
};
/** A fake `stellar` that signs whatever it is given with `kp`. */
const signingRunner = (kp: Keypair): StellarRunner => (_args, input) => signedBy(TransactionBuilder.fromXDR(input as string, Networks.TESTNET) as Transaction, kp);

describe("K2 cli-signer: the process call", () => {
  beforeEach(() => vi.mocked(execFileSync).mockReset());

  it("runs `stellar tx sign --sign-with-key <id> --network testnet --quiet` with no shell, a minimal env, and the XDR on stdin", () => {
    const tx = txOf();
    vi.mocked(execFileSync).mockImplementation((() => signedBy(tx, KEYPAIRS.keeper)) as never);
    process.env.SOME_API_TOKEN_TEST_ONLY = "must-not-reach-the-child";
    try {
      signWith(tx, "lending-keeper", KEYS.keeper, runStellar);
    } finally {
      delete process.env.SOME_API_TOKEN_TEST_ONLY;
    }
    expect(execFileSync).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = vi.mocked(execFileSync).mock.calls[0] as unknown as [string, string[], Record<string, unknown>];
    expect(cmd).toBe("stellar");
    expect(args).toEqual(["tx", "sign", "--sign-with-key", "lending-keeper", "--network", "testnet", "--quiet"]);
    expect(opts.shell).toBe(false);
    expect(opts.input).toBe(tx.toXDR());
    expect(opts.stdio).toEqual(["pipe", "pipe", "ignore"]); // stderr is never captured
    expect(opts.env).toEqual(stellarChildEnv(process.env));
    expect(Object.keys(opts.env as object)).not.toContain("SOME_API_TOKEN_TEST_ONLY");
  });

  it("publicKeyOf runs `stellar keys public-key <id>` and returns a checked G address", () => {
    vi.mocked(execFileSync).mockReturnValue(`${KEYS.keeper}\n` as never);
    expect(publicKeyOf("lending-keeper", runStellar)).toBe(KEYS.keeper);
    const [cmd, args, opts] = vi.mocked(execFileSync).mock.calls[0] as unknown as [string, string[], Record<string, unknown>];
    expect([cmd, ...args]).toEqual(["stellar", "keys", "public-key", "lending-keeper"]);
    expect(opts.shell).toBe(false);
    vi.mocked(execFileSync).mockReturnValue("not an address" as never);
    expect(() => publicKeyOf("lending-keeper", runStellar)).toThrow(/invalid address/);
  });
});

describe("K2 cli-signer: identity names", () => {
  it("accepts lowercase letters, digits and hyphens only", () => {
    for (const ok of ["lending-keeper", "demo-feed-writer", "a", "k1-2"]) expect(isIdentityName(ok), ok).toBe(true);
    const bad = [
      "", "Lending", "a b", "a_b", "../x", "x/y", "a;b", "$(id)", "-x y", "a".repeat(33),
      "S" + "A".repeat(55), // shaped like a secret key
      "kite urban dog", // a seed phrase
    ];
    for (const name of bad) expect(isIdentityName(name), name).toBe(false);
  });

  it("refuses a bad name before running anything", () => {
    const run = vi.fn<StellarRunner>();
    expect(() => signWith(txOf(), "SAAAA", KEYS.keeper, run)).toThrow(/not valid/);
    expect(() => signWith(txOf(), "a b", KEYS.keeper, run)).toThrow(/not valid/);
    expect(() => publicKeyOf("../etc", run)).toThrow(/not valid/);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("K2 cli-signer: the returned envelope is checked", () => {
  it("returns the signed transaction when exactly one new signature verifies for the expected account", () => {
    const tx = txOf();
    const signed = signWith(tx, "lending-keeper", KEYS.keeper, signingRunner(KEYPAIRS.keeper));
    expect(signed.signatures).toHaveLength(1);
    expect(Buffer.from(signed.hash()).equals(Buffer.from(tx.hash()))).toBe(true);
  });

  it("refuses an envelope with another hash", () => {
    const tx = txOf("10");
    const other = txOf("11");
    expect(() => signWith(tx, "lending-keeper", KEYS.keeper, () => signedBy(other, KEYPAIRS.keeper))).toThrow(/different hash/);
  });

  it("refuses an envelope signed by the wrong key", () => {
    const tx = txOf();
    expect(() => signWith(tx, "lending-keeper", KEYS.keeper, () => signedBy(tx, KEYPAIRS.other))).toThrow(/does not verify/);
  });

  it("refuses an envelope with no new signature, or with a second one", () => {
    const tx = txOf();
    expect(() => signWith(tx, "lending-keeper", KEYS.keeper, () => tx.toXDR())).toThrow(/exactly one new signature/);
    const twice = () => {
      const copy = TransactionBuilder.fromXDR(tx.toXDR(), Networks.TESTNET) as Transaction;
      copy.sign(KEYPAIRS.keeper, KEYPAIRS.other);
      return copy.toXDR();
    };
    expect(() => signWith(tx, "lending-keeper", KEYS.keeper, twice)).toThrow(/exactly one new signature/);
  });

  it("refuses output that is not an envelope", () => {
    expect(() => signWith(txOf(), "lending-keeper", KEYS.keeper, () => "AAAA not xdr")).toThrow(/not a transaction envelope/);
  });

  it("refuses a malformed expected account", () => {
    expect(() => signWith(txOf(), "lending-keeper", "GNOPE", signingRunner(KEYPAIRS.keeper))).toThrow(/account address/);
  });
});

describe("K2 cli-signer: child output never appears in an error", () => {
  const LEAK = "SBLEAKEDSECRETLOOKINGTEXT1234567890";

  it("a failing child: the error carries the exit status only", () => {
    const failing: StellarRunner = () => {
      throw Object.assign(new Error(`Command failed: stellar tx sign --sign-with-key lending-keeper ${LEAK}`), { status: 1, stdout: LEAK, stderr: LEAK });
    };
    let message = "";
    try {
      signWith(txOf(), "lending-keeper", KEYS.keeper, failing);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/stellar tx sign failed for identity lending-keeper \(exit status 1\)/);
    expect(message).not.toContain(LEAK);
    let keyMessage = "";
    try {
      publicKeyOf("lending-keeper", failing);
    } catch (err) {
      keyMessage = (err as Error).message;
    }
    expect(keyMessage).not.toContain(LEAK);
  });

  it("garbage on stdout is not echoed", () => {
    for (const run of [(() => LEAK) as StellarRunner]) {
      let message = "";
      try {
        signWith(txOf(), "lending-keeper", KEYS.keeper, run);
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).toBeTruthy();
      expect(message).not.toContain(LEAK);
    }
    let keyMessage = "";
    try {
      publicKeyOf("lending-keeper", () => LEAK);
    } catch (err) {
      keyMessage = (err as Error).message;
    }
    expect(keyMessage).not.toContain(LEAK);
  });
});
