/**
 * Read-only access to the feed contract on testnet: simulation only, no keys, no signing.
 * Fact sheets and other readers import this file (and `encode.ts`), never `client.ts`.
 */
import { Account, BASE_FEE, Contract, Networks, TransactionBuilder, rpc, scValToNative, xdr, type Transaction } from "@stellar/stellar-sdk";
import { FeedError, MAX_BATCH, addressesToScVal, decodeEntries, feedErrorFromText, type Entry } from "./encode";

export const DEFAULT_RPC_URL = "https://soroban-testnet.stellar.org";
/** Hosts known to serve testnet only. Add another with FEED_RPC_ALLOW_HOSTS (comma-separated); the passphrase is still checked. */
export const TESTNET_RPC_HOSTS: readonly string[] = ["soroban-testnet.stellar.org"];
/** An account that cannot exist; read calls are only simulated, so no real account is needed. */
const READ_SOURCE = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
export const TX_TIMEOUT_SECONDS = 120;

export const allowedRpcHosts = (env: Record<string, string | undefined> = process.env): string[] => [
  ...TESTNET_RPC_HOSTS,
  ...(env.FEED_RPC_ALLOW_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean),
];

/** https only, and a host on the allowlist (case-insensitive). */
export function assertTestnetRpcUrl(url: string, env: Record<string, string | undefined> = process.env): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("The RPC URL is not a valid URL");
  }
  if (parsed.protocol !== "https:") throw new Error("The RPC URL must use https");
  if (!allowedRpcHosts(env).includes(parsed.hostname.toLowerCase())) {
    throw new Error(`The RPC host ${parsed.hostname} is not on the testnet allowlist; set FEED_RPC_ALLOW_HOSTS to use another testnet provider`);
  }
  return parsed;
}

/** `FEED_RPC_URL` or the public testnet RPC, checked against the allowlist. */
export function feedRpcUrl(env: Record<string, string | undefined> = process.env): string {
  const url = (env.FEED_RPC_URL ?? "").trim() || DEFAULT_RPC_URL;
  assertTestnetRpcUrl(url, env);
  return url;
}

/** The part of `rpc.Server` the feed uses, so tests can pass a mock. */
export interface FeedRpc {
  getNetwork(): Promise<{ passphrase: string }>;
  getAccount(address: string): Promise<Account>;
  getAccountEntry(address: string): Promise<{ balance: unknown }>;
  simulateTransaction(tx: Transaction): Promise<rpc.Api.SimulateTransactionResponse>;
  sendTransaction(tx: Transaction): Promise<rpc.Api.SendTransactionResponse>;
  getTransaction(hash: string): Promise<rpc.Api.GetTransactionResponse>;
}

export const createRpc = (url = feedRpcUrl()): FeedRpc => new rpc.Server(url, { allowHttp: false });

export type Roles = { admin: string; publisher: string; schema: number };

export interface FeedReader {
  /** The passphrase the RPC reports. */
  passphrase(): Promise<string>;
  /** XLM stroops of the account. */
  balanceStroops(publicKey: string): Promise<bigint>;
  /** `get_many` by simulation, in chunks of at most 25; `null` for a key the feed does not know. */
  readEntries(keys: readonly string[]): Promise<(Entry | null)[]>;
  readRoles(): Promise<Roles>;
}

export type ReaderOptions = { rpc: FeedRpc; contractId: string };

export function buildTx(contract: Contract, source: Account, method: string, args: xdr.ScVal[]): Transaction {
  return new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(contract.call(method, ...args))
    .setTimeout(TX_TIMEOUT_SECONDS)
    .build();
}

/** Simulate one call and return the result value; a simulation error becomes a typed `FeedError`. */
export async function simulateCall(server: FeedRpc, contract: Contract, source: Account, method: string, args: xdr.ScVal[]) {
  const tx = buildTx(contract, source, method, args);
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw feedErrorFromText(sim.error, "simulation");
  if (!sim.result) throw new FeedError(`${method}: the simulation returned no result`, "simulation");
  return { tx, sim, retval: sim.result.retval };
}

export function createFeedReader(opts: ReaderOptions): FeedReader {
  const { rpc: server } = opts;
  const contract = new Contract(opts.contractId);
  const readSource = () => new Account(READ_SOURCE, "0");

  return {
    async passphrase() {
      return (await server.getNetwork()).passphrase;
    },

    async balanceStroops(publicKey) {
      const entry = await server.getAccountEntry(publicKey);
      return BigInt(String(entry.balance));
    },

    async readEntries(keys) {
      const out: (Entry | null)[] = [];
      for (let i = 0; i < keys.length; i += MAX_BATCH) {
        const chunk = keys.slice(i, i + MAX_BATCH);
        const { retval } = await simulateCall(server, contract, readSource(), "get_many", [addressesToScVal(chunk)]);
        out.push(...decodeEntries(retval, chunk));
      }
      return out;
    },

    async readRoles() {
      const [admin, publisher, schema] = await Promise.all(
        ["admin", "publisher", "schema"].map(async (m) => (await simulateCall(server, contract, readSource(), m, [])).retval),
      );
      const a = scValToNative(admin);
      const p = scValToNative(publisher);
      const s = scValToNative(schema);
      if (typeof a !== "string" || typeof p !== "string" || typeof s !== "number") throw new Error("The contract returned an unexpected shape for admin, publisher or schema");
      return { admin: a, publisher: p, schema: s };
    },
  };
}
