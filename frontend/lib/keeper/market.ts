/**
 * Read-only access to the mock lending market on testnet (spec 3 and 4.1): simulation only, no keys.
 * Decodes the market's `Decision`, `MarketState` and `Policy`, and maps its error and reason codes.
 * Also holds the typed chain error shared by `send.ts`. Node runtime only; no LLM (golden rule 1).
 */
import { Account, Address, Contract, rpc, scValToNative, xdr } from "@stellar/stellar-sdk";
import { buildTx, type FeedRpc } from "../feed/reader";

/** An account that cannot exist; read calls are only simulated. Same value as `lib/feed/reader.ts`. */
const READ_SOURCE = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

export const FEED_STATUS_NAMES: Readonly<Record<number, string>> = { 0: "OK", 1: "WARNING", 2: "CRITICAL" };

/** Reason codes of the market: public ABI, append-only (spec 3). 10 and 11 are state only, never a check result. */
export const REASON_NAMES: Readonly<Record<number, string>> = {
  0: "CLEAR",
  1: "NOT_COVERED",
  2: "FEED_UNAVAILABLE",
  3: "UNKNOWN_SCHEMA",
  4: "STALE",
  5: "STATUS",
  10: "LISTED",
  11: "MANUAL",
};
export const REASON = { CLEAR: 0, NOT_COVERED: 1, FEED_UNAVAILABLE: 2, UNKNOWN_SCHEMA: 3, STALE: 4, STATUS: 5, LISTED: 10, MANUAL: 11 } as const;

/** `MarketError` of the market contract: public ABI, fixed (spec 3). */
export const MARKET_ERROR_NAMES: Readonly<Record<number, string>> = {
  1: "NotInitialized",
  10: "InvalidPolicy",
  11: "AlreadyListed",
  12: "TooManyMarkets",
  13: "NotListed",
  20: "BorrowsPaused",
  21: "InvalidAmount",
  22: "Overflow",
  30: "PolicyBlocks",
};
export const ERROR_CODE = { BorrowsPaused: 20, PolicyBlocks: 30 } as const;

export const reasonName = (code: number): string => REASON_NAMES[code] ?? `UNKNOWN_REASON_${code}`;
export const feedStatusName = (code: number): string => FEED_STATUS_NAMES[code] ?? `UNKNOWN_STATUS_${code}`;

/** What `check` and `sync` return: the reason plus a copy of the entry's fields (zero for reasons 1 and 2). */
export type Decision = {
  reason: number;
  status: number;
  flags: number;
  as_of: bigint;
  /** Lowercase hex, 64 characters. */
  evidence_hash: string;
  published_ledger: number;
};

export type MarketState = {
  borrow_enabled: boolean;
  reason: number;
  changed_ledger: number;
  total_borrowed: bigint;
};

export type Policy = { pause_at: number; max_age: bigint };

export type ChainErrorKind = "contract" | "simulation" | "rejected" | "failed" | "timeout" | "unknown";

/**
 * A failed chain call. `code` and `errorName` are set when a contract rejected the call.
 * `timeout` and `unknown` mean the transaction may still land: its hash is in `txHash`.
 */
export class ChainError extends Error {
  constructor(
    message: string,
    readonly kind: ChainErrorKind,
    readonly code: number | null = null,
    readonly errorName: string | null = null,
    readonly txHash: string | null = null,
    /** Set when the transaction is confirmed on chain (SUCCESS) although the call is reported as an error. */
    readonly ledger: number | null = null,
  ) {
    super(message);
    this.name = "ChainError";
  }
}

export type ErrorNames = Readonly<Record<number, string>>;

/** The contract error code in an RPC simulation or host error text, e.g. `Error(Contract, #20)` gives 20. */
export function contractErrorCode(text: string): number | null {
  const m = /Error\(Contract,\s*#(\d+)\)/.exec(text);
  return m ? Number(m[1]) : null;
}

/** Build the typed error for a text that may carry a contract error code. */
export function chainErrorFromText(
  text: string,
  names: ErrorNames,
  kind: Exclude<ChainErrorKind, "contract"> = "simulation",
  txHash: string | null = null,
): ChainError {
  const code = contractErrorCode(text);
  if (code === null) return new ChainError(text, kind, null, null, txHash);
  const name = names[code] ?? null;
  return new ChainError(`contract error #${code}${name ? ` (${name})` : " (unknown code)"}`, "contract", code, name, txHash);
}

const U32_MAX = 0xffff_ffff;
const U64_MAX = (1n << 64n) - 1n;

function u32Field(m: Record<string, unknown>, what: string, k: string): number {
  const v = m[k];
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > U32_MAX) throw new Error(`${what}.${k} is not a u32`);
  return v;
}
function u64Field(m: Record<string, unknown>, what: string, k: string): bigint {
  const v = m[k];
  if (typeof v !== "bigint" || v < 0n || v > U64_MAX) throw new Error(`${what}.${k} is not a u64`);
  return v;
}

function asMap(scv: xdr.ScVal, what: string): Record<string, unknown> {
  if (scv.type !== "scvMap") throw new Error(`Expected ${what}, got ${scv.type}`);
  return scValToNative(scv) as Record<string, unknown>;
}

export function decodeDecision(scv: xdr.ScVal): Decision {
  const m = asMap(scv, "Decision");
  const hash = m.evidence_hash;
  if (!(hash instanceof Uint8Array) || hash.length !== 32) throw new Error("Decision.evidence_hash is not 32 bytes");
  return {
    reason: u32Field(m, "Decision", "reason"),
    status: u32Field(m, "Decision", "status"),
    flags: u32Field(m, "Decision", "flags"),
    as_of: u64Field(m, "Decision", "as_of"),
    evidence_hash: Buffer.from(hash).toString("hex"),
    published_ledger: u32Field(m, "Decision", "published_ledger"),
  };
}

export function decodeMarketState(scv: xdr.ScVal): MarketState {
  const m = asMap(scv, "MarketState");
  const enabled = m.borrow_enabled;
  if (typeof enabled !== "boolean") throw new Error("MarketState.borrow_enabled is not a bool");
  const borrowed = m.total_borrowed;
  if (typeof borrowed !== "bigint") throw new Error("MarketState.total_borrowed is not an i128");
  return {
    borrow_enabled: enabled,
    reason: u32Field(m, "MarketState", "reason"),
    changed_ledger: u32Field(m, "MarketState", "changed_ledger"),
    total_borrowed: borrowed,
  };
}

/** `Option<MarketState>`: void is `null`. */
export function decodeOptionMarketState(scv: xdr.ScVal): MarketState | null {
  return scv.type === "scvVoid" ? null : decodeMarketState(scv);
}

export function decodePolicy(scv: xdr.ScVal): Policy {
  const m = asMap(scv, "Policy");
  return { pause_at: u32Field(m, "Policy", "pause_at"), max_age: u64Field(m, "Policy", "max_age") };
}

export function decodeAddress(scv: xdr.ScVal): string {
  if (scv.type !== "scvAddress") throw new Error(`Expected an address, got ${scv.type}`);
  return Address.fromScVal(scv).toString();
}

export function decodeAddressVec(scv: xdr.ScVal): string[] {
  if (scv.type !== "scvVec" || !scv.value) throw new Error(`Expected Vec<Address>, got ${scv.type}`);
  return scv.value.map(decodeAddress);
}

export const addressToScVal = (a: string): xdr.ScVal => new Address(a).toScVal();

/** Simulate one call and return the result; a simulation error becomes a typed `ChainError`. */
export async function simulateContract(
  server: Pick<FeedRpc, "simulateTransaction">,
  contractId: string,
  source: Account,
  method: string,
  args: xdr.ScVal[],
  names: ErrorNames,
) {
  const tx = buildTx(new Contract(contractId), source, method, args);
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw chainErrorFromText(sim.error, names, "simulation");
  if (!sim.result) throw new ChainError(`${method}: the simulation returned no result`, "simulation");
  return { tx, sim, retval: sim.result.retval };
}

export interface MarketReader {
  check(key: string): Promise<Decision>;
  /** `null` when the asset is not listed in the market. */
  market(key: string): Promise<MarketState | null>;
  markets(): Promise<string[]>;
  feed(): Promise<string>;
  admin(): Promise<string>;
  policy(): Promise<Policy>;
}

export type MarketReaderOptions = { rpc: Pick<FeedRpc, "simulateTransaction">; contractId: string };

export function createMarketReader(opts: MarketReaderOptions): MarketReader {
  const read = async (method: string, args: xdr.ScVal[] = []) =>
    (await simulateContract(opts.rpc, opts.contractId, new Account(READ_SOURCE, "0"), method, args, MARKET_ERROR_NAMES)).retval;
  return {
    async check(key) {
      return decodeDecision(await read("check", [addressToScVal(key)]));
    },
    async market(key) {
      return decodeOptionMarketState(await read("market", [addressToScVal(key)]));
    },
    async markets() {
      return decodeAddressVec(await read("markets"));
    },
    async feed() {
      return decodeAddress(await read("feed"));
    },
    async admin() {
      return decodeAddress(await read("admin"));
    },
    async policy() {
      return decodePolicy(await read("policy"));
    },
  };
}

/** `Vec<Address>` of the keys a feed holds (`assets()` of the feed contract). Read only. */
export async function readFeedAssets(server: Pick<FeedRpc, "simulateTransaction">, feedContractId: string): Promise<string[]> {
  const { retval } = await simulateContract(server, feedContractId, new Account(READ_SOURCE, "0"), "assets", [], {});
  return decodeAddressVec(retval);
}
