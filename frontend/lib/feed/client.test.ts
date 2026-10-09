import { Account, Address, Networks, SorobanDataBuilder, nativeToScVal, rpc, xdr, type Transaction } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { DEFAULT_POLL_TIMEOUT_MS, MAX_FEE_STROOPS, createFeedClient } from "./client";
import { DEFAULT_RPC_URL, assertTestnetRpcUrl, feedRpcUrl, type FeedRpc } from "./reader";
import { FeedError, type Entry, type Update } from "./encode";
import { DEPLOYMENT, PUBLISHER, loadStatus, updatesOf } from "./testkit";

const addr = (v: xdr.ScVal) => Address.fromScVal(v).toString();
const sym = (s: string) => xdr.ScVal.scvSymbol(s);
const ent = (key: string, val: xdr.ScVal) => new xdr.ScMapEntry({ key: sym(key), val });
const entryScVal = (e: Entry) =>
  xdr.ScVal.scvMap([
    ent("as_of", xdr.ScVal.scvU64(e.as_of)),
    ent("evidence_hash", xdr.ScVal.scvBytes(Buffer.from(e.evidence_hash, "hex"))),
    ent("flags", xdr.ScVal.scvU32(e.flags)),
    ent("issuer_change_seen_at", xdr.ScVal.scvU64(e.issuer_change_seen_at)),
    ent("published_ledger", xdr.ScVal.scvU32(e.published_ledger)),
    ent("status", xdr.ScVal.scvU32(e.status)),
    ent("version", xdr.ScVal.scvU32(e.version)),
  ]);

const invocation = (tx: Transaction) => {
  const op = tx.operations[0] as unknown as { func: { invokeContract: { functionName: string | Uint8Array; args: xdr.ScVal[] } } };
  return { method: op.func.invokeContract.functionName.toString(), args: op.func.invokeContract.args };
};

const success = (retval: xdr.ScVal): rpc.Api.SimulateTransactionSuccessResponse => ({
  id: "1", latestLedger: 1, events: [], _parsed: true,
  transactionData: new SorobanDataBuilder(), minResourceFee: "100", result: { auth: [], retval },
});
const simError = (error: string): rpc.Api.SimulateTransactionErrorResponse => ({ id: "1", latestLedger: 1, events: [], _parsed: true, error });

type Mock = FeedRpc & { simulated: Transaction[]; sent: Transaction[]; polls: number };

/** A scripted RPC: no network. Each field is a hook the test sets. */
function mockRpc(over: Partial<{
  simulate: (tx: Transaction) => rpc.Api.SimulateTransactionResponse;
  send: (tx: Transaction) => rpc.Api.SendTransactionResponse;
  get: (hash: string, poll: number) => rpc.Api.GetTransactionResponse;
}> = {}): Mock {
  const m: Mock = {
    simulated: [], sent: [], polls: 0,
    async getNetwork() { return { passphrase: Networks.TESTNET }; },
    async getAccount(address) { return new Account(address, "41"); },
    async getAccountEntry() { return { balance: 123n }; },
    async simulateTransaction(tx) { m.simulated.push(tx); return (over.simulate ?? (() => success(xdr.ScVal.scvVoid())))(tx); },
    async sendTransaction(tx) { m.sent.push(tx); return (over.send ?? (() => ({ status: "PENDING", hash: "ab".repeat(32), latestLedger: 1, latestLedgerCloseTime: 1 }) as rpc.Api.SendTransactionResponse))(tx); },
    async getTransaction(hash) { return (over.get ?? (() => { throw new Error("unexpected getTransaction"); }))(hash, ++m.polls); },
  };
  return m;
}

const ok = (n: number, ledger = 777): rpc.Api.GetSuccessfulTransactionResponse =>
  ({ status: rpc.Api.GetTransactionStatus.SUCCESS, ledger, returnValue: nativeToScVal(n, { type: "u32" }) }) as unknown as rpc.Api.GetSuccessfulTransactionResponse;
const notFound = (): rpc.Api.GetMissingTransactionResponse => ({ status: rpc.Api.GetTransactionStatus.NOT_FOUND }) as rpc.Api.GetMissingTransactionResponse;

const client = (r: FeedRpc, extra: Partial<Parameters<typeof createFeedClient>[0]> = {}) =>
  createFeedClient({ rpc: r, contractId: DEPLOYMENT.contract_id, sleep: async () => {}, pollIntervalMs: 1, ...extra });

describe("feedRpcUrl", () => {
  it("defaults to the public testnet RPC and can be overridden", () => {
    expect(feedRpcUrl({})).toBe(DEFAULT_RPC_URL);
    expect(DEFAULT_RPC_URL).toBe("https://soroban-testnet.stellar.org");
    expect(feedRpcUrl({ FEED_RPC_URL: "https://rpc.example.test/x", FEED_RPC_ALLOW_HOSTS: "rpc.example.test" })).toBe("https://rpc.example.test/x");
    expect(feedRpcUrl({ FEED_RPC_URL: "  " })).toBe(DEFAULT_RPC_URL);
  });
  it("accepts only allowlisted testnet hosts, case-insensitively", () => {
    expect(() => assertTestnetRpcUrl("https://SOROBAN-TESTNET.stellar.org/")).not.toThrow();
    expect(() => assertTestnetRpcUrl("https://mainnet.sorobanrpc.com", {})).toThrow(/not on the testnet allowlist/);
    expect(() => assertTestnetRpcUrl("https://soroban-testnet.stellar.org.evil.test", {})).toThrow(/allowlist/);
    expect(() => feedRpcUrl({ FEED_RPC_URL: "https://rpc.example.test/x" })).toThrow(/allowlist/);
  });
  it("refuses http and garbage", () => {
    expect(() => feedRpcUrl({ FEED_RPC_URL: "http://soroban-testnet.stellar.org" })).toThrow(/https/);
    expect(() => feedRpcUrl({ FEED_RPC_URL: "nope" })).toThrow(/not a valid URL/);
  });
});

describe("readEntries", () => {
  const keys = updatesOf(loadStatus()).map((u) => u.asset); // 27
  const stored = (key: string): Entry => ({ asset: key, version: 1, status: 0, flags: 0, evidence_hash: "11".repeat(32), as_of: 5n, issuer_change_seen_at: 0n, published_ledger: 9 });

  it("simulates get_many in chunks of at most 25 and returns the entries in order", async () => {
    // The mock knows the first and last key only; every other key is unknown (void).
    const known = new Set([keys[0], keys[26]]);
    const r = mockRpc({
      simulate: (tx) => {
        const { method, args } = invocation(tx);
        expect(method).toBe("get_many");
        const chunkKeys = (args[0] as xdr.ScVal & { value: xdr.ScVal[] }).value.map((a) => addr(a));
        return success(xdr.ScVal.scvVec(chunkKeys.map((k) => (known.has(k) ? entryScVal(stored(k)) : xdr.ScVal.scvVoid()))));
      },
    });
    const out = await client(r).readEntries(keys);
    expect(r.simulated.map((t) => (invocation(t).args[0] as xdr.ScVal & { value: unknown[] }).value.length)).toEqual([25, 2]);
    expect(out).toHaveLength(27);
    expect(out[0]).toEqual(stored(keys[0]));
    expect(out[26]).toEqual(stored(keys[26]));
    expect(out.filter((e) => e === null)).toHaveLength(25);
    expect(r.sent).toHaveLength(0); // reads never send
  });

  it("makes no call for no keys, and one call for exactly 25", async () => {
    const r = mockRpc({ simulate: () => success(xdr.ScVal.scvVec(Array.from({ length: 25 }, () => xdr.ScVal.scvVoid()))) });
    expect(await client(r).readEntries([])).toEqual([]);
    expect(r.simulated).toHaveLength(0);
    await client(r).readEntries(keys.slice(0, 25));
    expect(r.simulated).toHaveLength(1);
  });

  it("reads with a source account that is not the publisher, and never signs", async () => {
    const r = mockRpc({ simulate: () => success(xdr.ScVal.scvVec([xdr.ScVal.scvVoid()])) });
    await client(r).readEntries([keys[0]]);
    expect(r.simulated[0].source).not.toBe(PUBLISHER.publicKey());
    expect(r.simulated[0].signatures).toHaveLength(0);
  });
});

describe("readRoles", () => {
  it("reads admin, publisher and schema", async () => {
    const r = mockRpc({
      simulate: (tx) => {
        const { method } = invocation(tx);
        if (method === "schema") return success(xdr.ScVal.scvU32(1));
        return success(new Address(method === "admin" ? DEPLOYMENT.admin : DEPLOYMENT.publisher).toScVal());
      },
    });
    expect(await client(r).readRoles()).toEqual({ admin: DEPLOYMENT.admin, publisher: DEPLOYMENT.publisher, schema: 1 });
  });
});

describe("simulatePublish (dry run)", () => {
  const updates = updatesOf(loadStatus()).slice(0, 3);

  it("returns the written count without signing or sending", async () => {
    const r = mockRpc({ simulate: () => success(nativeToScVal(3, { type: "u32" })) });
    expect(await client(r).simulatePublish(updates, PUBLISHER.publicKey())).toEqual({ written: 3, minResourceFee: "100" });
    expect(r.simulated).toHaveLength(1);
    expect(r.simulated[0].signatures).toHaveLength(0);
    expect(r.sent).toHaveLength(0);
    expect(invocation(r.simulated[0]).method).toBe("publish");
  });

  it("maps a contract error to a typed FeedError", async () => {
    const r = mockRpc({ simulate: () => simError("HostError: Error(Contract, #30)") });
    const err = await client(r).simulatePublish(updates, PUBLISHER.publicKey()).catch((e) => e);
    expect(err).toBeInstanceOf(FeedError);
    expect(err).toMatchObject({ kind: "contract", code: 30, errorName: "StaleAsOf" });
  });

  it("says so when the publisher account does not exist", async () => {
    const r = mockRpc();
    r.getAccount = async () => { throw new Error("Account not found"); };
    await expect(client(r).simulatePublish(updates, PUBLISHER.publicKey())).rejects.toThrow(/not found on testnet/);
  });
});

describe("publishBatch", () => {
  const updates = updatesOf(loadStatus()).slice(0, 3);
  /** The hash the client computed before sending: it is the one on the transaction the mock received. */
  const sentHash = (r: Mock) => Buffer.from(r.sent[0].hash()).toString("hex");

  it("builds, simulates, assembles, signs with the publisher, sends, and polls until SUCCESS", async () => {
    const r = mockRpc({
      simulate: () => success(nativeToScVal(3, { type: "u32" })),
      get: (_h, poll) => (poll < 3 ? notFound() : ok(3, 4242)),
    });
    const res = await client(r).publishBatch(updates, PUBLISHER);
    expect(res).toEqual({ txHash: sentHash(r), ledger: 4242, written: 3 });
    expect(sentHash(r)).toMatch(/^[0-9a-f]{64}$/);
    expect(r.polls).toBe(3);
    expect(r.sent).toHaveLength(1);
    const tx = r.sent[0];
    expect(tx.source).toBe(PUBLISHER.publicKey());
    expect(tx.networkPassphrase).toBe(Networks.TESTNET);
    expect(tx.signatures).toHaveLength(1);
    expect(Number(tx.sequence)).toBe(42);
    expect(invocation(tx).method).toBe("publish");
    expect(Number(tx.fee)).toBeGreaterThanOrEqual(100);
  });

  it("refuses an empty batch and a batch over 25 before any RPC call", async () => {
    const r = mockRpc();
    const many = Array.from({ length: 26 }, () => updates[0]) as Update[];
    await expect(client(r).publishBatch(many, PUBLISHER)).rejects.toMatchObject({ code: 11, errorName: "BatchTooLarge" });
    await expect(client(r).publishBatch([], PUBLISHER)).rejects.toMatchObject({ code: 10, errorName: "EmptyBatch" });
    expect(r.simulated).toHaveLength(0);
  });

  it("does not send when the simulation fails", async () => {
    const r = mockRpc({ simulate: () => simError("HostError: Error(Contract, #12)") });
    await expect(client(r).publishBatch(updates, PUBLISHER)).rejects.toMatchObject({ kind: "contract", code: 12, errorName: "DuplicateAsset" });
    expect(r.sent).toHaveLength(0);
  });

  it("reports a refused send", async () => {
    const r = mockRpc({
      simulate: () => success(nativeToScVal(3, { type: "u32" })),
      send: () => ({ status: "ERROR", hash, latestLedger: 1, latestLedgerCloseTime: 1 }) as rpc.Api.SendTransactionResponse,
    });
    await expect(client(r).publishBatch(updates, PUBLISHER)).rejects.toMatchObject({ kind: "rejected", txHash: sentHash(r) });
  });

  it("reports a transaction that failed on chain", async () => {
    const r = mockRpc({
      simulate: () => success(nativeToScVal(3, { type: "u32" })),
      get: () => ({ status: rpc.Api.GetTransactionStatus.FAILED }) as rpc.Api.GetFailedTransactionResponse,
    });
    await expect(client(r).publishBatch(updates, PUBLISHER)).rejects.toMatchObject({ kind: "failed", txHash: sentHash(r), ledger: null });
  });

  it("times out when the transaction never appears, naming the hash", async () => {
    let clock = 0;
    const r = mockRpc({ simulate: () => success(nativeToScVal(3, { type: "u32" })), get: () => notFound() });
    const err = await client(r, { now: () => clock, sleep: async (ms) => void (clock += ms), pollTimeoutMs: 5000, pollIntervalMs: 1000 })
      .publishBatch(updates, PUBLISHER).catch((e) => e);
    expect(err).toMatchObject({ kind: "timeout", txHash: sentHash(r) });
    expect(r.polls).toBeGreaterThan(2);
    expect(r.polls).toBeLessThan(10);
  });

  it("fails if the contract wrote a different number of entries, and says the transaction is on chain", async () => {
    const r = mockRpc({ simulate: () => success(nativeToScVal(3, { type: "u32" })), get: () => ok(2, 555) });
    await expect(client(r).publishBatch(updates, PUBLISHER)).rejects.toMatchObject({ kind: "failed", txHash: sentHash(r), ledger: 555 });
  });

  it("a SUCCESS without a return value is still confirmed on chain (hash and ledger on the error)", async () => {
    const noValue = { status: rpc.Api.GetTransactionStatus.SUCCESS, ledger: 600 } as unknown as rpc.Api.GetSuccessfulTransactionResponse;
    const r = mockRpc({ simulate: () => success(nativeToScVal(3, { type: "u32" })), get: () => noValue });
    await expect(client(r).publishBatch(updates, PUBLISHER)).rejects.toMatchObject({ kind: "failed", txHash: sentHash(r), ledger: 600 });
  });

  it("keeps the hash when sendTransaction itself throws (the transaction may have been accepted)", async () => {
    const r = mockRpc({ simulate: () => success(nativeToScVal(3, { type: "u32" })) });
    r.sendTransaction = async (tx) => { r.sent.push(tx); throw new Error("socket hang up"); };
    const err = await client(r).publishBatch(updates, PUBLISHER).catch((e) => e);
    expect(err).toBeInstanceOf(FeedError);
    expect(err).toMatchObject({ kind: "unknown", txHash: sentHash(r), ledger: null });
    expect(err.message).toContain("socket hang up");
  });

  it("keeps polling through transient getTransaction errors and succeeds", async () => {
    const r = mockRpc({
      simulate: () => success(nativeToScVal(3, { type: "u32" })),
      get: (_h, poll) => { if (poll < 3) throw new Error("503 Service Unavailable"); return ok(3, 9); },
    });
    expect(await client(r).publishBatch(updates, PUBLISHER)).toMatchObject({ ledger: 9, written: 3 });
    expect(r.polls).toBe(3);
  });

  it("times out with the hash and the last RPC error when getTransaction keeps failing", async () => {
    let clock = 0;
    const r = mockRpc({ simulate: () => success(nativeToScVal(3, { type: "u32" })), get: () => { throw new Error("connection reset"); } });
    const err = await client(r, { now: () => clock, sleep: async (ms) => void (clock += ms), pollTimeoutMs: 3000, pollIntervalMs: 1000 })
      .publishBatch(updates, PUBLISHER).catch((e) => e);
    expect(err).toMatchObject({ kind: "timeout", txHash: sentHash(r) });
    expect(err.message).toContain("connection reset");
  });

  it("waits at least the transaction's validity plus 15 s by default", () => {
    expect(DEFAULT_POLL_TIMEOUT_MS).toBeGreaterThanOrEqual(120 * 1000 + 15_000);
  });

  it("refuses to sign a transaction whose fee is above the cap", async () => {
    const r = mockRpc({ simulate: () => ({ ...success(nativeToScVal(3, { type: "u32" })), minResourceFee: String(MAX_FEE_STROOPS + 1n) }) });
    const err = await client(r).publishBatch(updates, PUBLISHER).catch((e) => e);
    expect(err).toBeInstanceOf(FeedError);
    expect(err.message).toMatch(/above the cap/);
    expect(r.sent).toHaveLength(0);
  });
});

describe("balanceStroops", () => {
  it("returns the account balance", async () => {
    expect(await client(mockRpc()).balanceStroops(PUBLISHER.publicKey())).toBe(123n);
  });
});
