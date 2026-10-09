/**
 * Soroban RPC client for the feed contract (testnet only, golden rule 6).
 *
 * Reads simulate and never sign. `publishBatch` is the only function that signs; it takes the
 * keypair as an argument and never logs or returns it. Called only from `scripts/publish-feed.ts`.
 *
 * Node runtime only. Nothing under `agent/` or `app/api/agent` may import this file (golden rule 1).
 */
import {
  Account, BASE_FEE, Contract, Networks, TransactionBuilder, rpc, scValToNative, xdr,
  type Keypair, type Transaction,
} from "@stellar/stellar-sdk";
import {
  FeedError, MAX_BATCH, addressesToScVal, decodeEntries, feedErrorFromText, updatesToScVal,
  type Entry, type Update,
} from "./encode";

export const DEFAULT_RPC_URL = "https://soroban-testnet.stellar.org";
/** An account that cannot exist; read calls are only simulated, so no real account is needed. */
const READ_SOURCE = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const TX_TIMEOUT_SECONDS = 120;
const DEFAULT_POLL_TIMEOUT_MS = 90_000;
const DEFAULT_POLL_INTERVAL_MS = 1_500;

/** `FEED_RPC_URL` or the public testnet RPC. Only https is accepted; the passphrase is checked again before any write. */
export function feedRpcUrl(env: Record<string, string | undefined> = process.env): string {
  const url = (env.FEED_RPC_URL ?? "").trim() || DEFAULT_RPC_URL;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("FEED_RPC_URL is not a valid URL");
  }
  if (parsed.protocol !== "https:") throw new Error("FEED_RPC_URL must use https");
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
export type PublishResult = { txHash: string; ledger: number; written: number };
export type SimulationResult = { written: number; minResourceFee: string };

export interface FeedClient {
  /** The passphrase the RPC reports. */
  passphrase(): Promise<string>;
  /** XLM stroops of the account, for the publisher's balance check. */
  balanceStroops(publicKey: string): Promise<bigint>;
  /** `get_many` by simulation, in chunks of at most 25; `null` for a key the feed does not know. */
  readEntries(keys: readonly string[]): Promise<(Entry | null)[]>;
  readRoles(): Promise<Roles>;
  /** Simulate `publish` as the publisher; throws a typed `FeedError` if the contract would reject it. No signing. */
  simulatePublish(updates: readonly Update[], publisherPublicKey: string): Promise<SimulationResult>;
  /** Build, simulate, sign, send, and wait for one `publish` transaction. */
  publishBatch(updates: readonly Update[], keypair: Keypair): Promise<PublishResult>;
}

export type ClientOptions = {
  rpc: FeedRpc;
  contractId: string;
  pollTimeoutMs?: number;
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createFeedClient(opts: ClientOptions): FeedClient {
  const { rpc: server, contractId } = opts;
  const contract = new Contract(contractId);
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? Date.now;
  const pollTimeoutMs = opts.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  function buildTx(source: Account, method: string, args: xdr.ScVal[]): Transaction {
    return new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
      .addOperation(contract.call(method, ...args))
      .setTimeout(TX_TIMEOUT_SECONDS)
      .build();
  }

  /** Simulate and return the result value; a simulation error becomes a typed `FeedError`. */
  async function simulate(source: Account, method: string, args: xdr.ScVal[]) {
    const tx = buildTx(source, method, args);
    const sim = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) throw feedErrorFromText(sim.error, "simulation");
    if (!sim.result) throw new FeedError(`${method}: the simulation returned no result`, "simulation");
    return { tx, sim, retval: sim.result.retval };
  }

  const readSource = () => new Account(READ_SOURCE, "0");

  async function readOne(method: string): Promise<xdr.ScVal> {
    return (await simulate(readSource(), method, [])).retval;
  }

  async function sourceAccount(publicKey: string): Promise<Account> {
    try {
      return await server.getAccount(publicKey);
    } catch {
      throw new FeedError(`The publisher account ${publicKey} was not found on testnet; fund it first`, "simulation");
    }
  }

  async function pollTransaction(hash: string): Promise<rpc.Api.GetSuccessfulTransactionResponse | rpc.Api.GetFailedTransactionResponse> {
    const deadline = now() + pollTimeoutMs;
    for (;;) {
      const res = await server.getTransaction(hash);
      if (res.status === rpc.Api.GetTransactionStatus.SUCCESS || res.status === rpc.Api.GetTransactionStatus.FAILED) return res;
      if (now() >= deadline) {
        throw new FeedError(`Timed out waiting for transaction ${hash}; its outcome is unknown, check it on the explorer before retrying`, "timeout", null, hash);
      }
      await sleep(pollIntervalMs);
    }
  }

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
        const { retval } = await simulate(readSource(), "get_many", [addressesToScVal(chunk)]);
        out.push(...decodeEntries(retval, chunk));
      }
      return out;
    },

    async readRoles() {
      const [admin, publisher, schema] = await Promise.all(["admin", "publisher", "schema"].map(readOne));
      const a = scValToNative(admin);
      const p = scValToNative(publisher);
      const s = scValToNative(schema);
      if (typeof a !== "string" || typeof p !== "string" || typeof s !== "number") throw new Error("The contract returned an unexpected shape for admin, publisher or schema");
      return { admin: a, publisher: p, schema: s };
    },

    async simulatePublish(updates, publisherPublicKey) {
      const { sim, retval } = await simulate(await sourceAccount(publisherPublicKey), "publish", [updatesToScVal(updates)]);
      return { written: Number(scValToNative(retval)), minResourceFee: sim.minResourceFee };
    },

    async publishBatch(updates, keypair) {
      if (updates.length === 0 || updates.length > MAX_BATCH) {
        throw new FeedError(`A batch has 1 to ${MAX_BATCH} updates, got ${updates.length}`, "contract", updates.length === 0 ? 10 : 11);
      }
      const account = await sourceAccount(keypair.publicKey());
      const tx = buildTx(account, "publish", [updatesToScVal(updates)]);
      const sim = await server.simulateTransaction(tx);
      if (rpc.Api.isSimulationError(sim)) throw feedErrorFromText(sim.error, "simulation");
      const prepared = rpc.assembleTransaction(tx, sim).build();
      prepared.sign(keypair);
      const sent = await server.sendTransaction(prepared);
      if (sent.status === "ERROR" || sent.status === "TRY_AGAIN_LATER") {
        throw new FeedError(`The network refused the transaction (${sent.status})`, "rejected", null, sent.hash);
      }
      const done = await pollTransaction(sent.hash);
      if (done.status === rpc.Api.GetTransactionStatus.FAILED) {
        throw new FeedError(`Transaction ${sent.hash} failed on chain`, "failed", null, sent.hash);
      }
      const written = done.returnValue ? Number(scValToNative(done.returnValue)) : -1;
      if (written !== updates.length) {
        throw new FeedError(`Transaction ${sent.hash} wrote ${written} entries, expected ${updates.length}`, "failed", null, sent.hash);
      }
      return { txHash: sent.hash, ledger: done.ledger, written };
    },
  };
}
