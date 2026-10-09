/**
 * Publishing client for the feed contract (testnet only, golden rule 6). Adds the signing path
 * to the read-only reader. `publishBatch` is the only function that signs; it takes the keypair
 * as an argument and never logs or returns it. Called only from `scripts/publish-feed.ts`.
 *
 * Node runtime only. Nothing reachable from `agent/` or `app/` may import this file (golden rule 1).
 */
import { Account, Contract, rpc, scValToNative, type Keypair } from "@stellar/stellar-sdk";
import { FeedError, MAX_BATCH, feedErrorFromText, updatesToScVal, type Update } from "./encode";
import {
  TX_TIMEOUT_SECONDS, buildTx, createFeedReader, simulateCall,
  type FeedReader, type FeedRpc,
} from "./reader";

export { DEFAULT_RPC_URL, createRpc, feedRpcUrl, type FeedRpc, type Roles } from "./reader";

/** The transaction is valid for TX_TIMEOUT_SECONDS; wait that long plus a margin before calling the outcome unknown. */
export const DEFAULT_POLL_TIMEOUT_MS = TX_TIMEOUT_SECONDS * 1000 + 15_000;
const DEFAULT_POLL_INTERVAL_MS = 1_500;
/** Stroops. A fee above this is refused (10 XLM): a bad simulation must not drain the publisher. */
export const MAX_FEE_STROOPS = 100_000_000n;

export type PublishResult = { txHash: string; ledger: number; written: number };
export type SimulationResult = { written: number; minResourceFee: string };

export interface FeedClient extends FeedReader {
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
const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function createFeedClient(opts: ClientOptions): FeedClient {
  const { rpc: server } = opts;
  const contract = new Contract(opts.contractId);
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? Date.now;
  const pollTimeoutMs = opts.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  async function sourceAccount(publicKey: string): Promise<Account> {
    try {
      return await server.getAccount(publicKey);
    } catch {
      throw new FeedError(`The publisher account ${publicKey} was not found on testnet; fund it first`, "simulation");
    }
  }

  /** Poll until the transaction is final. A transient RPC error does not end the wait: the transaction may be on chain. */
  async function pollTransaction(hash: string): Promise<rpc.Api.GetSuccessfulTransactionResponse | rpc.Api.GetFailedTransactionResponse> {
    const deadline = now() + pollTimeoutMs;
    let lastError: string | null = null;
    for (;;) {
      try {
        const res = await server.getTransaction(hash);
        lastError = null;
        if (res.status === rpc.Api.GetTransactionStatus.SUCCESS || res.status === rpc.Api.GetTransactionStatus.FAILED) return res;
      } catch (err) {
        lastError = messageOf(err);
      }
      if (now() >= deadline) {
        throw new FeedError(
          `Timed out waiting for transaction ${hash}${lastError ? ` (last RPC error: ${lastError})` : ""}; its outcome is unknown, check it on the explorer before retrying`,
          "timeout", null, hash,
        );
      }
      await sleep(pollIntervalMs);
    }
  }

  return {
    ...createFeedReader({ rpc: server, contractId: opts.contractId }),

    async simulatePublish(updates, publisherPublicKey) {
      const { sim, retval } = await simulateCall(server, contract, await sourceAccount(publisherPublicKey), "publish", [updatesToScVal(updates)]);
      return { written: Number(scValToNative(retval)), minResourceFee: sim.minResourceFee };
    },

    async publishBatch(updates, keypair) {
      if (updates.length === 0 || updates.length > MAX_BATCH) {
        throw new FeedError(`A batch has 1 to ${MAX_BATCH} updates, got ${updates.length}`, "contract", updates.length === 0 ? 10 : 11);
      }
      const account = await sourceAccount(keypair.publicKey());
      const tx = buildTx(contract, account, "publish", [updatesToScVal(updates)]);
      const sim = await server.simulateTransaction(tx);
      if (rpc.Api.isSimulationError(sim)) throw feedErrorFromText(sim.error, "simulation");
      const prepared = rpc.assembleTransaction(tx, sim).build();
      if (BigInt(prepared.fee) > MAX_FEE_STROOPS) {
        throw new FeedError(`The transaction fee ${prepared.fee} stroops is above the cap of ${MAX_FEE_STROOPS}; nothing was signed`, "simulation");
      }
      prepared.sign(keypair);
      // The hash is known from here on. Every error below carries it, so a sent transaction is never lost.
      const hash = Buffer.from(prepared.hash()).toString("hex");
      let sent: rpc.Api.SendTransactionResponse;
      try {
        sent = await server.sendTransaction(prepared);
      } catch (err) {
        throw new FeedError(`Sending transaction ${hash} failed (${messageOf(err)}); it may still land, check it on the explorer before retrying`, "unknown", null, hash);
      }
      if (sent.status === "ERROR" || sent.status === "TRY_AGAIN_LATER") {
        throw new FeedError(`The network refused the transaction (${sent.status})`, "rejected", null, hash);
      }
      const done = await pollTransaction(hash);
      if (done.status === rpc.Api.GetTransactionStatus.FAILED) {
        throw new FeedError(`Transaction ${hash} failed on chain`, "failed", null, hash);
      }
      let written = -1;
      try {
        if (done.returnValue) written = Number(scValToNative(done.returnValue));
      } catch {
        written = -1;
      }
      if (written !== updates.length) {
        // SUCCESS: it is on chain. The ledger is attached so the caller logs it before it reports the problem.
        throw new FeedError(`Transaction ${hash} succeeded in ledger ${done.ledger} but its return value (${written}) is not the ${updates.length} entries sent`, "failed", null, hash, done.ledger);
      }
      return { txHash: hash, ledger: done.ledger, written };
    },
  };
}
