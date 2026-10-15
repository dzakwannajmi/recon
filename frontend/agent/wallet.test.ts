/**
 * agent/wallet.ts is public-only (golden rule 8): the address comes from AGENT_PUBLIC_KEY or the wallet
 * file's publicKey field, and no secret is ever loaded. No network: fetch is stubbed.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { Keypair } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WalletError, createWallet, fundWallet, getWalletAddress, walletFilePath } from "./wallet";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "wallet-test-"));
  vi.spyOn(process, "cwd").mockReturnValue(dir);
  vi.stubEnv("AGENT_PUBLIC_KEY", "");
  vi.stubEnv("AGENT_SECRET_KEY", "");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fs.rmSync(dir, { recursive: true, force: true });
});

const writeFile = (content: unknown) => fs.writeFileSync(path.join(dir, ".agent-wallet.json"), JSON.stringify(content));
const okFetch = () => vi.fn(async () => new Response("{}", { status: 200 }));

describe("getWalletAddress", () => {
  it("resolves the wallet file under the working directory", () => {
    expect(walletFilePath()).toBe(path.join(dir, ".agent-wallet.json"));
  });

  it("is null with no env var and no file", () => {
    expect(getWalletAddress()).toBeNull();
  });

  it("uses a valid AGENT_PUBLIC_KEY", () => {
    const pub = Keypair.random().publicKey();
    vi.stubEnv("AGENT_PUBLIC_KEY", ` ${pub} `);
    expect(getWalletAddress()).toBe(pub);
  });

  it("rejects an invalid AGENT_PUBLIC_KEY with a clear error that does not echo the value", () => {
    for (const bad of ["not-a-key", Keypair.random().secret(), `${Keypair.random().publicKey()}X`]) {
      vi.stubEnv("AGENT_PUBLIC_KEY", bad);
      expect(() => getWalletAddress()).toThrow(WalletError);
      expect(() => getWalletAddress()).toThrow(/AGENT_PUBLIC_KEY is not a valid Stellar public key/);
      try {
        getWalletAddress();
      } catch (err) {
        expect((err as Error).message).not.toContain(bad);
      }
    }
  });

  it("falls back to the file's publicKey field", () => {
    const kp = Keypair.random();
    writeFile({ publicKey: kp.publicKey(), secret: kp.secret() });
    expect(getWalletAddress()).toBe(kp.publicKey());
  });

  it("never reads a secret: AGENT_SECRET_KEY and the file's secret are ignored, even when both are garbage", () => {
    const fromSecret = vi.spyOn(Keypair, "fromSecret");
    const filePub = Keypair.random().publicKey();
    writeFile({ publicKey: filePub, secret: "garbage-that-would-throw" });
    vi.stubEnv("AGENT_SECRET_KEY", "also-garbage-that-would-throw");
    expect(getWalletAddress()).toBe(filePub);

    const envPub = Keypair.random().publicKey();
    vi.stubEnv("AGENT_PUBLIC_KEY", envPub);
    expect(getWalletAddress()).toBe(envPub);
    expect(fromSecret).not.toHaveBeenCalled();
  });

  it("refuses a file without a valid publicKey field, even if it holds a secret", () => {
    const kp = Keypair.random();
    writeFile({ secret: kp.secret() });
    expect(() => getWalletAddress()).toThrow(/no valid public key/);
    fs.writeFileSync(path.join(dir, ".agent-wallet.json"), "{not json");
    expect(() => getWalletAddress()).toThrow(/unreadable/);
  });
});

describe("fundWallet", () => {
  it("asks Friendbot for the AGENT_PUBLIC_KEY address", async () => {
    const pub = Keypair.random().publicKey();
    vi.stubEnv("AGENT_PUBLIC_KEY", pub);
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);
    await expect(fundWallet()).resolves.toEqual({ funded: true, address: pub });
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain(encodeURIComponent(pub));
  });

  it("refuses with no wallet and sends nothing", async () => {
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);
    await expect(fundWallet()).rejects.toThrow(WalletError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("createWallet", () => {
  it("refuses when AGENT_PUBLIC_KEY is set, and writes no file", async () => {
    vi.stubEnv("AGENT_PUBLIC_KEY", Keypair.random().publicKey());
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);
    await expect(createWallet()).rejects.toThrow(/set by AGENT_PUBLIC_KEY/);
    expect(fs.existsSync(path.join(dir, ".agent-wallet.json"))).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("locally saves a fresh keypair (mode 0600), funds it, and returns only the public address", async () => {
    vi.stubGlobal("fetch", okFetch());
    const address = await createWallet();
    const file = path.join(dir, ".agent-wallet.json");
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(address).toBe(saved.publicKey);
    expect(address).toMatch(/^G[A-Z2-7]{55}$/);
    expect(Keypair.fromSecret(saved.secret).publicKey()).toBe(address);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it("returns the existing address and never overwrites the file", async () => {
    const kp = Keypair.random();
    writeFile({ publicKey: kp.publicKey(), secret: kp.secret() });
    const before = fs.readFileSync(path.join(dir, ".agent-wallet.json"), "utf8");
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);
    await expect(createWallet()).resolves.toBe(kp.publicKey());
    expect(fs.readFileSync(path.join(dir, ".agent-wallet.json"), "utf8")).toBe(before);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
