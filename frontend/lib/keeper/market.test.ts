import { Address, SorobanDataBuilder, nativeToScVal, rpc, xdr, type Transaction } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import {
  ChainError, ERROR_CODE, MARKET_ERROR_NAMES, REASON, REASON_NAMES, chainErrorFromText, contractErrorCode, createMarketReader, decodeAddressVec,
  decodeDecision, decodeMarketState, decodeOptionMarketState, decodePolicy, feedStatusName, readFeedAssets, reasonName,
} from "./market";
import { BENJI_KEY, IDS, USTRY_KEY } from "./testkit";

const sym = (s: string) => xdr.ScVal.scvSymbol(s);
const ent = (key: string, val: xdr.ScVal) => new xdr.ScMapEntry({ key: sym(key), val });
const u32 = (n: number) => xdr.ScVal.scvU32(n);
const u64 = (n: bigint) => xdr.ScVal.scvU64(n);

const decisionScVal = (over: Partial<{ reason: number; status: number; flags: number; as_of: bigint; hash: Buffer; ledger: number }> = {}) =>
  xdr.ScVal.scvMap([
    ent("as_of", u64(over.as_of ?? 1_791_551_983n)),
    ent("evidence_hash", xdr.ScVal.scvBytes(over.hash ?? Buffer.alloc(32, 0xab))),
    ent("flags", u32(over.flags ?? 1)),
    ent("published_ledger", u32(over.ledger ?? 5_111_525)),
    ent("reason", u32(over.reason ?? 5)),
    ent("status", u32(over.status ?? 2)),
  ]);

const stateScVal = (enabled: boolean, reason = 0, borrowed = 7n) =>
  xdr.ScVal.scvMap([
    ent("borrow_enabled", xdr.ScVal.scvBool(enabled)),
    ent("changed_ledger", u32(42)),
    ent("reason", u32(reason)),
    ent("total_borrowed", nativeToScVal(borrowed, { type: "i128" })),
  ]);

describe("K1 decode: Decision, MarketState, Policy", () => {
  it("decodes a Decision from a ScVal map", () => {
    expect(decodeDecision(decisionScVal())).toEqual({
      reason: 5, status: 2, flags: 1, as_of: 1_791_551_983n, evidence_hash: "ab".repeat(32), published_ledger: 5_111_525,
    });
  });

  it("refuses a Decision with a wrong shape", () => {
    expect(() => decodeDecision(xdr.ScVal.scvVoid())).toThrow(/Expected Decision/);
    expect(() => decodeDecision(decisionScVal({ hash: Buffer.alloc(31) }))).toThrow(/32 bytes/);
    const noReason = xdr.ScVal.scvMap([ent("as_of", u64(1n)), ent("evidence_hash", xdr.ScVal.scvBytes(Buffer.alloc(32))), ent("flags", u32(0)), ent("published_ledger", u32(0)), ent("status", u32(0))]);
    expect(() => decodeDecision(noReason)).toThrow(/reason is not a u32/);
  });

  it("decodes MarketState, including an i128 total and the Option wrapper", () => {
    expect(decodeMarketState(stateScVal(false, 5, 12n))).toEqual({ borrow_enabled: false, reason: 5, changed_ledger: 42, total_borrowed: 12n });
    expect(decodeOptionMarketState(xdr.ScVal.scvVoid())).toBeNull();
    expect(decodeOptionMarketState(stateScVal(true))).toMatchObject({ borrow_enabled: true });
    expect(() => decodeMarketState(xdr.ScVal.scvMap([ent("borrow_enabled", u32(1))]))).toThrow(/borrow_enabled is not a bool/);
  });

  it("decodes Policy and address lists", () => {
    expect(decodePolicy(xdr.ScVal.scvMap([ent("max_age", u64(691_200n)), ent("pause_at", u32(2))]))).toEqual({ pause_at: 2, max_age: 691_200n });
    expect(decodeAddressVec(xdr.ScVal.scvVec([new Address(BENJI_KEY).toScVal(), new Address(USTRY_KEY).toScVal()]))).toEqual([BENJI_KEY, USTRY_KEY]);
    expect(() => decodeAddressVec(xdr.ScVal.scvVoid())).toThrow(/Vec<Address>/);
  });
});

describe("K1 names", () => {
  it("names every reason and error code of the ABI, and marks an unknown one", () => {
    expect(REASON_NAMES).toEqual({ 0: "CLEAR", 1: "NOT_COVERED", 2: "FEED_UNAVAILABLE", 3: "UNKNOWN_SCHEMA", 4: "STALE", 5: "STATUS", 10: "LISTED", 11: "MANUAL" });
    expect(reasonName(REASON.STATUS)).toBe("STATUS");
    expect(reasonName(99)).toBe("UNKNOWN_REASON_99");
    expect(MARKET_ERROR_NAMES[ERROR_CODE.BorrowsPaused]).toBe("BorrowsPaused");
    expect(MARKET_ERROR_NAMES[ERROR_CODE.PolicyBlocks]).toBe("PolicyBlocks");
    expect(Object.values(MARKET_ERROR_NAMES)).toEqual(["NotInitialized", "InvalidPolicy", "AlreadyListed", "TooManyMarkets", "NotListed", "BorrowsPaused", "InvalidAmount", "Overflow", "PolicyBlocks"]);
    expect([feedStatusName(0), feedStatusName(1), feedStatusName(2)]).toEqual(["OK", "WARNING", "CRITICAL"]);
  });

  it("maps a host error text to a typed error with the contract code", () => {
    expect(contractErrorCode("HostError: Error(Contract, #20)\nEvent log")).toBe(20);
    expect(contractErrorCode("no code here")).toBeNull();
    const e = chainErrorFromText("HostError: Error(Contract, #20)", MARKET_ERROR_NAMES);
    expect(e).toBeInstanceOf(ChainError);
    expect([e.kind, e.code, e.errorName, e.message]).toEqual(["contract", 20, "BorrowsPaused", "contract error #20 (BorrowsPaused)"]);
    expect(chainErrorFromText("Error(Contract, #77)", MARKET_ERROR_NAMES).message).toMatch(/unknown code/);
    const plain = chainErrorFromText("something else", MARKET_ERROR_NAMES, "simulation", "ab".repeat(32));
    expect([plain.kind, plain.code, plain.txHash]).toEqual(["simulation", null, "ab".repeat(32)]);
  });
});

describe("createMarketReader (mock RPC)", () => {
  const success = (retval: xdr.ScVal): rpc.Api.SimulateTransactionSuccessResponse => ({
    id: "1", latestLedger: 1, events: [], _parsed: true, transactionData: new SorobanDataBuilder(), minResourceFee: "100", result: { auth: [], retval },
  });
  const invocation = (tx: Transaction) => {
    const op = tx.operations[0] as unknown as { func: { invokeContract: { functionName: string | Uint8Array; args: xdr.ScVal[] } } };
    return { method: op.func.invokeContract.functionName.toString(), args: op.func.invokeContract.args };
  };
  const server = (answer: (method: string, args: xdr.ScVal[]) => xdr.ScVal | string) => {
    const calls: { method: string; source: string; signatures: number }[] = [];
    return {
      calls,
      simulateTransaction: async (tx: Transaction) => {
        const { method, args } = invocation(tx);
        calls.push({ method, source: tx.source, signatures: tx.signatures.length });
        const a = answer(method, args);
        return typeof a === "string" ? ({ id: "1", latestLedger: 1, events: [], _parsed: true, error: a } as rpc.Api.SimulateTransactionErrorResponse) : success(a);
      },
    };
  };

  it("reads check, market, markets, feed, admin and policy by simulation, with an unfunded source and no signature", async () => {
    const s = server((method) => {
      if (method === "check") return decisionScVal({ reason: 0, status: 0, flags: 0 });
      if (method === "market") return stateScVal(true);
      if (method === "markets") return xdr.ScVal.scvVec([new Address(BENJI_KEY).toScVal()]);
      if (method === "feed") return new Address(IDS.reconFeed).toScVal();
      if (method === "admin") return new Address(IDS.demoFeed).toScVal();
      return xdr.ScVal.scvMap([ent("max_age", u64(5n)), ent("pause_at", u32(1))]);
    });
    const reader = createMarketReader({ rpc: s, contractId: IDS.liveMarket });
    expect((await reader.check(BENJI_KEY)).reason).toBe(0);
    expect((await reader.market(BENJI_KEY))?.borrow_enabled).toBe(true);
    expect(await reader.markets()).toEqual([BENJI_KEY]);
    expect(await reader.feed()).toBe(IDS.reconFeed);
    expect(await reader.admin()).toBe(IDS.demoFeed);
    expect(await reader.policy()).toEqual({ pause_at: 1, max_age: 5n });
    expect(s.calls.map((c) => c.method)).toEqual(["check", "market", "markets", "feed", "admin", "policy"]);
    expect(s.calls.every((c) => c.signatures === 0 && c.source === "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF")).toBe(true);
  });

  it("turns a contract error in a simulation into a typed ChainError with the market's name", async () => {
    const reader = createMarketReader({ rpc: server(() => "HostError: Error(Contract, #13)"), contractId: IDS.liveMarket });
    await expect(reader.check(BENJI_KEY)).rejects.toMatchObject({ kind: "contract", code: 13, errorName: "NotListed" });
  });

  it("reads the keys a feed holds", async () => {
    const s = server(() => xdr.ScVal.scvVec([new Address(USTRY_KEY).toScVal()]));
    expect(await readFeedAssets(s, IDS.reconFeed)).toEqual([USTRY_KEY]);
  });
});
