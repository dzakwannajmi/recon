/**
 * The web wallet path works with AGENT_PUBLIC_KEY alone (W3.5 A1, golden rule 8): GET /api/wallet,
 * POST /api/wallet, and the chat's wallet tools never load a secret, even when AGENT_SECRET_KEY and the
 * wallet file's secret are garbage. No network: Horizon and fetch are stubbed.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { Horizon, Keypair } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { tools } from "@/agent/tools";
import { GET, POST } from "./route";

let dir: string;
let pub: string;
let fromSecret: MockInstance;
let fetchMock: ReturnType<typeof vi.fn>;

const tool = (name: string) => tools.find((t) => t.name === name)!;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "wallet-route-test-"));
  vi.spyOn(process, "cwd").mockReturnValue(dir);
  pub = Keypair.random().publicKey();
  vi.stubEnv("AGENT_PUBLIC_KEY", pub);
  vi.stubEnv("AGENT_SECRET_KEY", "garbage-that-would-throw-if-read");
  // A wallet file whose secret is also garbage and whose publicKey differs: neither may be used.
  fs.writeFileSync(path.join(dir, ".agent-wallet.json"), JSON.stringify({ publicKey: Keypair.random().publicKey(), secret: "garbage-too" }));
  fromSecret = vi.spyOn(Keypair, "fromSecret");
  vi.spyOn(Horizon.Server.prototype, "loadAccount").mockImplementation(async (id: string) => {
    if (id !== pub) throw new Error(`unexpected account ${id}`);
    return { balances: [{ asset_type: "native", balance: "100.0000000" }] } as unknown as Horizon.AccountResponse;
  });
  fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  expect(fromSecret).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("GET /api/wallet with only the public key", () => {
  it("returns the configured address, its balance, and the explorer link", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      address: pub,
      balance: "100.0000000 XLM",
      explorer: `https://stellar.expert/explorer/testnet/account/${pub}`,
    });
  });

  it("answers 500 with a clear message when AGENT_PUBLIC_KEY is invalid", async () => {
    vi.stubEnv("AGENT_PUBLIC_KEY", "not-a-key");
    const res = await GET();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/AGENT_PUBLIC_KEY is not a valid Stellar public key/);
  });
});

describe("POST /api/wallet with only the public key", () => {
  it("answers 409 with the refusal message, and writes or funds nothing", async () => {
    const before = fs.readFileSync(path.join(dir, ".agent-wallet.json"), "utf8");
    const res = await POST();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/The wallet is set by AGENT_PUBLIC_KEY/);
    expect(fs.readFileSync(path.join(dir, ".agent-wallet.json"), "utf8")).toBe(before);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("the chat's wallet tools with only the public key", () => {
  it("get_my_wallet returns the configured address and balances", async () => {
    expect(await tool("get_my_wallet").run({}, {})).toEqual({
      address: pub,
      balances: ["100.0000000 XLM"],
      network: "Stellar testnet",
      explorer: `https://stellar.expert/explorer/testnet/account/${pub}`,
    });
  });

  it("fund_my_wallet asks Friendbot for the configured address", async () => {
    expect(await tool("fund_my_wallet").run({}, {})).toEqual({ funded: true, address: pub });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain(`addr=${pub}`);
  });
});
