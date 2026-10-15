/**
 * agent/signer.ts: the operator-only signing key. A key that does not match the configured public
 * address must never sign. Errors never echo a secret. No network.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { Keypair } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignerError, getAgentKeypair } from "./signer";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "signer-test-"));
  vi.spyOn(process, "cwd").mockReturnValue(dir);
  vi.stubEnv("AGENT_PUBLIC_KEY", "");
  vi.stubEnv("AGENT_SECRET_KEY", "");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
});

const writeFile = (content: unknown) => fs.writeFileSync(path.join(dir, ".agent-wallet.json"), JSON.stringify(content));

/** Run fn, expect a SignerError, and check its message holds none of the given secrets. */
function expectSignerError(fn: () => unknown, pattern: RegExp, secrets: string[]) {
  let caught: unknown;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(SignerError);
  expect((caught as Error).message).toMatch(pattern);
  for (const s of secrets) expect((caught as Error).message).not.toContain(s);
}

describe("getAgentKeypair", () => {
  it("is null with no secret configured", () => {
    expect(getAgentKeypair()).toBeNull();
    vi.stubEnv("AGENT_PUBLIC_KEY", Keypair.random().publicKey());
    expect(getAgentKeypair()).toBeNull();
  });

  it("loads AGENT_SECRET_KEY when it matches AGENT_PUBLIC_KEY", () => {
    const kp = Keypair.random();
    vi.stubEnv("AGENT_SECRET_KEY", kp.secret());
    vi.stubEnv("AGENT_PUBLIC_KEY", kp.publicKey());
    expect(getAgentKeypair()?.publicKey()).toBe(kp.publicKey());
  });

  it("loads AGENT_SECRET_KEY alone when no public key is configured", () => {
    const kp = Keypair.random();
    vi.stubEnv("AGENT_SECRET_KEY", kp.secret());
    expect(getAgentKeypair()?.publicKey()).toBe(kp.publicKey());
  });

  it("throws when AGENT_SECRET_KEY does not match AGENT_PUBLIC_KEY, without echoing the secret", () => {
    const signing = Keypair.random();
    const configured = Keypair.random().publicKey();
    vi.stubEnv("AGENT_SECRET_KEY", signing.secret());
    vi.stubEnv("AGENT_PUBLIC_KEY", configured);
    expectSignerError(() => getAgentKeypair(), /does not match the configured wallet address/, [signing.secret()]);
  });

  it("throws when the wallet file's secret does not match its publicKey field", () => {
    const signing = Keypair.random();
    writeFile({ publicKey: Keypair.random().publicKey(), secret: signing.secret() });
    expectSignerError(() => getAgentKeypair(), /does not match/, [signing.secret()]);
  });

  it("throws when the wallet file's secret does not match AGENT_PUBLIC_KEY", () => {
    const signing = Keypair.random();
    writeFile({ publicKey: signing.publicKey(), secret: signing.secret() });
    vi.stubEnv("AGENT_PUBLIC_KEY", Keypair.random().publicKey());
    expectSignerError(() => getAgentKeypair(), /does not match/, [signing.secret()]);
  });

  it("loads the wallet file's secret when it matches", () => {
    const kp = Keypair.random();
    writeFile({ publicKey: kp.publicKey(), secret: kp.secret() });
    expect(getAgentKeypair()?.publicKey()).toBe(kp.publicKey());
  });

  it("prefers AGENT_SECRET_KEY over the file, and still checks it against the configured address", () => {
    const fileKp = Keypair.random();
    writeFile({ publicKey: fileKp.publicKey(), secret: fileKp.secret() });
    const envKp = Keypair.random();
    vi.stubEnv("AGENT_SECRET_KEY", envKp.secret());
    expectSignerError(() => getAgentKeypair(), /does not match/, [envKp.secret(), fileKp.secret()]);
    vi.stubEnv("AGENT_PUBLIC_KEY", envKp.publicKey());
    expect(getAgentKeypair()?.publicKey()).toBe(envKp.publicKey());
  });

  it("rejects an invalid AGENT_SECRET_KEY or file secret without echoing it", () => {
    const bad = "SNOTAREALSECRETBUTLOOKSCLOSE";
    vi.stubEnv("AGENT_SECRET_KEY", bad);
    expectSignerError(() => getAgentKeypair(), /AGENT_SECRET_KEY is not a valid Stellar secret key/, [bad]);
    vi.stubEnv("AGENT_SECRET_KEY", "");
    writeFile({ publicKey: Keypair.random().publicKey(), secret: bad });
    expectSignerError(() => getAgentKeypair(), /wallet file has no valid secret key/, [bad]);
  });
});
