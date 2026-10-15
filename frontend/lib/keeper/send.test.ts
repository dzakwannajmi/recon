import { Account, Networks, SorobanDataBuilder, rpc, xdr, type Transaction, type Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import { describe, expect, it, vi } from "vitest";
import type { StellarRunner } from "./cli-signer";
import { ChainError, MARKET_ERROR_NAMES, addressToScVal } from "./market";
import { MAX_FEE_STROOPS, eventNamesOf, invoke, refuseSecondSigner, simulateInvoke, type InvokeRequest, type SendRpc } from "./send";
import { BENJI_KEY, IDS, KEYPAIRS, KEYS } from "./testkit";

const HASH_OF_SENT: { value: string } = { value: "" };

const success = (minResourceFee = "100", auth: unknown[] = []): rpc.Api.SimulateTransactionSuccessResponse =>
  ({ id: "1", latestLedger: 1, events: [], _parsed: true, transactionData: new SorobanDataBuilder().setResourceFee(BigInt(minResourceFee)), minResourceFee, result: { auth, retval: xdr.ScVal.scvVoid() } }) as unknown as rpc.Api.SimulateTransactionSuccessResponse;
const simError = (error: string): rpc.Api.SimulateTransactionErrorResponse => ({ id: "1", latestLedger: 1, events: [], _parsed: true, error });
const found = (over: Record<string, unknown> = {}) => ({ status: rpc.Api.GetTransactionStatus.SUCCESS, ledger: 777, ...over }) as unknown as rpc.Api.GetTransactionResponse;
const notFound = () => ({ status: rpc.Api.GetTransactionStatus.NOT_FOUND }) as rpc.Api.GetTransactionResponse;

type Mock = SendRpc & { simulated: Transaction[]; sent: Transaction[]; polls: number };
function mockRpc(over: Partial<{
  simulate: () => rpc.Api.SimulateTransactionResponse;
  send: () => rpc.Api.SendTransactionResponse | Promise<never>;
  get: (n: number) => rpc.Api.GetTransactionResponse;
  account: () => Promise<Account>;
}> = {}): Mock {
  const m: Mock = {
    simulated: [], sent: [], polls: 0,
    getAccount: over.account ?? (async (a) => new Account(a, "41")),
    async simulateTransaction(tx) { m.simulated.push(tx); return (over.simulate ?? (() => success()))(); },
    async sendTransaction(tx) { m.sent.push(tx); HASH_OF_SENT.value = Buffer.from(tx.hash()).toString("hex"); return (over.send ?? (() => ({ status: "PENDING", hash: "x", latestLedger: 1, latestLedgerCloseTime: 1 }) as rpc.Api.SendTransactionResponse))(); },
    async getTransaction() { return (over.get ?? (() => found()))(++m.polls); },
  };
  return m;
}

const signing = (kp: Keypair): StellarRunner => (_a, input) => {
  const tx = TransactionBuilder.fromXDR(input as string, Networks.TESTNET) as Transaction;
  tx.sign(kp);
  return tx.toXDR();
};

const req: InvokeRequest = { contractId: IDS.liveMarket, method: "sync", args: [addressToScVal(BENJI_KEY)], source: KEYS.keeper, identity: "lending-keeper", errorNames: MARKET_ERROR_NAMES };

/** A clock that only `sleep` advances, so a polling loop that never ends fails fast. */
const clock = () => {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => void (t += ms) };
};
const deps = (r: SendRpc, run: StellarRunner = signing(KEYPAIRS.keeper)) => ({ rpc: r, run, pollIntervalMs: 1000, pollTimeoutMs: 5000, ...clock() });

describe("invoke: the happy path", () => {
  it("builds, simulates, signs through the runner, sends once, polls, and returns the hash, ledger and event names", async () => {
    const r = mockRpc({ get: (n) => (n < 3 ? notFound() : found({ events: { contractEventsXdr: [[{ body: { v0: { topics: [{ type: "scvSymbol", value: "borrows_paused" }, { type: "scvVoid" }] } } }]] } })) });
    const res = await invoke(req, deps(r));
    expect(r.simulated).toHaveLength(1);
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0].signatures).toHaveLength(1);
    expect(res.txHash).toBe(HASH_OF_SENT.value); // the hash is the one of the signed transaction that was sent
    expect(res.ledger).toBe(777);
    expect(res.events).toEqual(["borrows_paused"]);
    expect(r.polls).toBe(3);
  });

  it("returns events: null when the RPC gives none", async () => {
    const res = await invoke(req, deps(mockRpc()));
    expect(res.events).toBeNull();
    expect(eventNamesOf({ events: { contractEventsXdr: "bad" } })).toBeNull();
  });
});

describe("invoke: refusals before anything is signed", () => {
  it("a simulation error becomes a typed error with the contract code and name", async () => {
    const run = vi.fn<StellarRunner>();
    const r = mockRpc({ simulate: () => simError("HostError: Error(Contract, #20)") });
    await expect(invoke(req, deps(r, run))).rejects.toMatchObject({ kind: "contract", code: 20, errorName: "BorrowsPaused" });
    expect(run).not.toHaveBeenCalled();
    expect(r.sent).toHaveLength(0);
  });

  it("refuses a fee above the cap of 5 XLM", async () => {
    const run = vi.fn<StellarRunner>();
    const r = mockRpc({ simulate: () => success(String(MAX_FEE_STROOPS + 1n)) });
    await expect(invoke(req, deps(r, run))).rejects.toThrow(/above the cap/);
    expect(run).not.toHaveBeenCalled();
    expect(MAX_FEE_STROOPS).toBe(50_000_000n);
  });

  it("refuses a simulation that asks for a second signer (address credentials)", async () => {
    const run = vi.fn<StellarRunner>();
    const r = mockRpc({ simulate: () => success("100", [{ credentials: { type: "sorobanCredentialsAddress" } }]) });
    await expect(invoke(req, deps(r, run))).rejects.toThrow(/other than the transaction source/);
    expect(run).not.toHaveBeenCalled();
    expect(r.sent).toHaveLength(0);
    expect(() => refuseSecondSigner([{ credentials: { type: "sorobanCredentialsSourceAccount" } } as never])).not.toThrow();
    expect(() => refuseSecondSigner([{ credentials: { type: "sorobanCredentialsAddressV2" } } as never])).toThrow();
    expect(() => refuseSecondSigner(undefined)).not.toThrow();
  });

  it("refuses a simulation that needs a restore", async () => {
    const run = vi.fn<StellarRunner>();
    const restore = { ...success(), restorePreamble: { minResourceFee: "1", transactionData: new SorobanDataBuilder() } } as unknown as rpc.Api.SimulateTransactionResponse;
    await expect(invoke(req, deps(mockRpc({ simulate: () => restore }), run))).rejects.toThrow(/restore/);
    expect(run).not.toHaveBeenCalled();
  });

  it("a missing source account is a clear error", async () => {
    const r = mockRpc({ account: async () => { throw new Error("not found"); } });
    await expect(invoke(req, deps(r))).rejects.toThrow(/was not found on testnet/);
  });

  it("a signature from the wrong key is refused and nothing is sent", async () => {
    const r = mockRpc();
    await expect(invoke(req, deps(r, signing(KEYPAIRS.other)))).rejects.toThrow(/does not verify/);
    expect(r.sent).toHaveLength(0);
  });
});

describe("invoke: after the transaction is signed", () => {
  it("a send that throws is reported with the hash and is not retried", async () => {
    const r = mockRpc({ send: () => Promise.reject(new Error("socket hang up")) });
    const err = await invoke(req, deps(r)).catch((e) => e as ChainError);
    expect(err).toBeInstanceOf(ChainError);
    expect(err).toMatchObject({ kind: "unknown", txHash: HASH_OF_SENT.value });
    expect(err.message).toContain(HASH_OF_SENT.value);
    expect(r.sent).toHaveLength(1);
  });

  it("a refused transaction is reported as rejected", async () => {
    const r = mockRpc({ send: () => ({ status: "ERROR", hash: "x", latestLedger: 1, latestLedgerCloseTime: 1 }) as rpc.Api.SendTransactionResponse });
    await expect(invoke(req, deps(r))).rejects.toMatchObject({ kind: "rejected", txHash: HASH_OF_SENT.value });
  });

  it("a transaction that fails on chain is reported with its hash", async () => {
    const r = mockRpc({ get: () => ({ status: rpc.Api.GetTransactionStatus.FAILED }) as rpc.Api.GetTransactionResponse });
    await expect(invoke(req, deps(r))).rejects.toMatchObject({ kind: "failed", txHash: HASH_OF_SENT.value });
    expect(r.sent).toHaveLength(1);
  });

  it("a transient RPC error while polling does not end the wait; a timeout is an unknown outcome with the hash", async () => {
    const flaky = mockRpc({ get: (n) => { if (n === 1) throw new Error("503"); return found(); } });
    expect((await invoke(req, deps(flaky))).ledger).toBe(777);
    const never = mockRpc({ get: () => notFound() });
    const err = await invoke(req, deps(never)).catch((e) => e as ChainError);
    expect(err).toMatchObject({ kind: "timeout", txHash: HASH_OF_SENT.value });
    expect(err.message).toMatch(/outcome is unknown/);
    expect(never.sent).toHaveLength(1);
  });
});

describe("simulateInvoke", () => {
  it("simulates as the given source without signing or sending", async () => {
    const r = mockRpc({ simulate: () => simError("Error(Contract, #30)") });
    const { identity: _identity, ...noIdentity } = req;
    await expect(simulateInvoke(r, noIdentity)).rejects.toMatchObject({ code: 30, errorName: "PolicyBlocks" });
    expect(r.simulated[0].source).toBe(KEYS.keeper);
    expect(r.simulated[0].signatures).toHaveLength(0);
    expect(r.sent).toHaveLength(0);
    expect(addressToScVal(KEYS.admin)).toBeDefined();
  });
});
