/**
 * Send one contract call on testnet, signed through stellar-cli (D-045). Rules of `lib/feed/client.ts`:
 * the hash is known before sending, and an unknown outcome is reported and never re-sent automatically.
 *
 * Every `require_auth` address in the keeper's calls is the transaction source, so a simulation that returns
 * an auth entry with address credentials (a second signer) is refused. The fee is capped at 5 XLM.
 * No LLM, no secret: signing is `cli-signer.ts`. Node runtime only.
 */
import { Account, Contract, rpc, xdr, type Transaction } from "@stellar/stellar-sdk";
import { TX_TIMEOUT_SECONDS, buildTx, type FeedRpc } from "../feed/reader";
import { signWith, type StellarRunner } from "./cli-signer";
import { ChainError, chainErrorFromText, simulateContract, type ErrorNames } from "./market";

/** Stroops. A fee above this (5 XLM) is refused: a bad simulation must not drain the signer. */
export const MAX_FEE_STROOPS = 50_000_000n;
export const DEFAULT_POLL_TIMEOUT_MS = TX_TIMEOUT_SECONDS * 1000 + 15_000;
const DEFAULT_POLL_INTERVAL_MS = 1_500;

export type InvokeRequest = {
  contractId: string;
  method: string;
  args: xdr.ScVal[];
  /** The account (G...) that is the transaction source and the only signer. */
  source: string;
  /** The stellar-cli identity whose public key must be `source`. */
  identity: string;
  /** Names for the contract's error codes (the market's or the feed's). */
  errorNames: ErrorNames;
};

export type InvokeResult = {
  txHash: string;
  ledger: number;
  returnValue: xdr.ScVal | null;
  /** First topic of each contract event, as the contract wrote it (for example `borrows_paused`). `null` when the RPC did not return events. */
  events: string[] | null;
};

/** The part of the RPC `send` uses. */
export type SendRpc = Pick<FeedRpc, "getAccount" | "simulateTransaction" | "sendTransaction" | "getTransaction">;

export type SendDeps = {
  rpc: SendRpc;
  run?: StellarRunner;
  pollTimeoutMs?: number;
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Throws if any auth entry needs a signature other than the transaction source's. */
export function refuseSecondSigner(auth: readonly xdr.SorobanAuthorizationEntry[] | undefined): void {
  for (const entry of auth ?? []) {
    if (entry.credentials.type !== "sorobanCredentialsSourceAccount") {
      throw new ChainError("The simulation asks for a signature from an address other than the transaction source; nothing was signed", "simulation");
    }
  }
}

/** Event names from a `getTransaction` result; `null` if the RPC gave none or they can't be read. */
export function eventNamesOf(done: unknown): string[] | null {
  const groups = (done as { events?: { contractEventsXdr?: unknown } } | null)?.events?.contractEventsXdr;
  if (!Array.isArray(groups)) return null;
  try {
    const names: string[] = [];
    for (const group of groups.flat() as xdr.ContractEvent[]) {
      const topic = group.body.v0.topics[0];
      names.push(topic && topic.type === "scvSymbol" ? topic.value : "");
    }
    return names;
  } catch {
    return null;
  }
}

/** Simulate a call as `source` and return its result. No signing, no sending. */
export async function simulateInvoke(server: Pick<SendRpc, "getAccount" | "simulateTransaction">, req: Omit<InvokeRequest, "identity">) {
  const account = await server.getAccount(req.source).catch(() => {
    throw new ChainError(`The account ${req.source} was not found on testnet; fund it first`, "simulation");
  });
  return simulateContract(server, req.contractId, account, req.method, req.args, req.errorNames);
}

export async function invoke(req: InvokeRequest, deps: SendDeps): Promise<InvokeResult> {
  const server = deps.rpc;
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? Date.now;
  const pollTimeoutMs = deps.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
  const pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  const account: Account = await server.getAccount(req.source).catch(() => {
    throw new ChainError(`The account ${req.source} was not found on testnet; fund it first`, "simulation");
  });
  const tx = buildTx(new Contract(req.contractId), account, req.method, req.args);
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw chainErrorFromText(sim.error, req.errorNames, "simulation");
  if (rpc.Api.isSimulationRestore(sim)) throw new ChainError("The simulation needs a state restore, which the keeper does not do; nothing was signed", "simulation");
  refuseSecondSigner(sim.result?.auth);
  const prepared = rpc.assembleTransaction(tx, sim).build();
  if (BigInt(prepared.fee) > MAX_FEE_STROOPS) {
    throw new ChainError(`The transaction fee ${prepared.fee} stroops is above the cap of ${MAX_FEE_STROOPS}; nothing was signed`, "simulation");
  }
  const signed: Transaction = signWith(prepared, req.identity, req.source, deps.run);
  // The hash is known from here on. Every error below carries it, so a sent transaction is never lost.
  const hash = Buffer.from(signed.hash()).toString("hex");
  let sent: rpc.Api.SendTransactionResponse;
  try {
    sent = await server.sendTransaction(signed);
  } catch (err) {
    throw new ChainError(`Sending transaction ${hash} failed (${messageOf(err)}); it may still land, check it on the explorer before retrying`, "unknown", null, null, hash);
  }
  if (sent.status === "ERROR" || sent.status === "TRY_AGAIN_LATER") {
    throw new ChainError(`The network refused the transaction (${sent.status})`, "rejected", null, null, hash);
  }

  const deadline = now() + pollTimeoutMs;
  let lastError: string | null = null;
  for (;;) {
    try {
      const res = await server.getTransaction(hash);
      lastError = null;
      if (res.status === rpc.Api.GetTransactionStatus.FAILED) throw new ChainError(`Transaction ${hash} failed on chain`, "failed", null, null, hash);
      if (res.status === rpc.Api.GetTransactionStatus.SUCCESS) {
        return { txHash: hash, ledger: res.ledger, returnValue: res.returnValue ?? null, events: eventNamesOf(res) };
      }
    } catch (err) {
      if (err instanceof ChainError) throw err;
      lastError = messageOf(err);
    }
    if (now() >= deadline) {
      throw new ChainError(
        `Timed out waiting for transaction ${hash}${lastError ? ` (last RPC error: ${lastError})` : ""}; its outcome is unknown, check it on the explorer before retrying`,
        "timeout", null, null, hash,
      );
    }
    await sleep(pollIntervalMs);
  }
}
