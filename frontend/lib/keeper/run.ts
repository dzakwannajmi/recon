/**
 * The keeper (spec 4.3): finds markets that need a pause and pays the fee for `sync`. The pause rule runs on
 * chain; this code only decides whether to send the permissionless `sync`, from the market's own `check`.
 * It never writes to Recon's feed, holds no key (signing is `cli-signer.ts`), and uses no LLM (golden rule 1).
 * Testnet only (golden rule 6). Output uses the words "feed status", "market policy", "paused" and "open".
 *
 * Node runtime only. Nothing under `app/` or `agent/` may import this file.
 */
import fs from "node:fs";
import path from "node:path";
import { Networks } from "@stellar/stellar-sdk";
import type { Entry } from "../feed/encode";
import { assertTestnetRpcUrl, type FeedRpc, type Roles } from "../feed/reader";
import { decisionToJson, type KeeperLogRecord } from "./log";
import {
  ChainError, MARKET_ERROR_NAMES, REASON, addressToScVal, executableOf, feedStatusName, reasonName,
  type Decision, type LedgerRpc, type MarketReader, type MarketState,
} from "./market";
import {
  FEED_WASM_HASH, IDENTITIES, RECON_FEED_ID, checkRecords,
  type KeeperDeployment, type MarketName, type ReconFeedRecord, type Scenario, type UniverseRow,
} from "./records";
import type { InvokeRequest, InvokeResult } from "./send";

/** A precondition failed: nothing was signed. */
export class KeeperRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeeperRefusal";
  }
}

/** The keeper account needs XLM for fees; below this it stops. */
export const MIN_KEEPER_BALANCE_STROOPS = 100_000_000n;

export type KeeperOptions = { market: MarketName; dryRun: boolean; sendAll: boolean };

export type KeeperDeps = {
  deployment: KeeperDeployment;
  scenario: Scenario;
  recon: ReconFeedRecord;
  universe: readonly UniverseRow[];
  rpcUrl: string;
  /** Environment for the RPC host allowlist (`FEED_RPC_ALLOW_HOSTS`). */
  env?: Record<string, string | undefined>;
  rpc: Pick<FeedRpc, "getNetwork" | "getAccountEntry"> & LedgerRpc;
  /** Reader of the market selected in `opts.market`. */
  market: MarketReader;
  /** Entries of a feed by key, by simulation. */
  readEntries(feedContractId: string, keys: readonly string[]): Promise<(Entry | null)[]>;
  /** `admin()` and `publisher()` of a feed, on chain. */
  feedRoles(feedContractId: string): Promise<Roles>;
  /** The keys a feed holds (`assets()`). */
  feedAssets(feedContractId: string): Promise<string[]>;
  publicKeyOf(identity: string): string;
  send(req: InvokeRequest): Promise<InvokeResult>;
  /** Simulation only; used by `--dry-run`. */
  simulate(req: Omit<InvokeRequest, "identity">): Promise<unknown>;
  /** Display only: flags the status file did not evaluate for this key. Never a decision input. */
  notEvaluated?(key: string): { file: string; flags: string[] } | null;
  appendLog(record: KeeperLogRecord): void;
  now(): Date;
  out(line: string): void;
};

export type KeeperRow = {
  label: string;
  key: string;
  decision: Decision;
  before: MarketState;
  after: MarketState;
  txHash: string | null;
  ledger: number | null;
  events: string[] | null;
  action: "sync" | "none" | "dry-run";
};

/**
 * 0 done; 1 refused (a record, identity or consistency check failed; nothing signed); 2 a transaction outcome unknown;
 * 3 a transaction failed; 4 the preconditions passed but an asset could not be evaluated while its market is open or unknown
 * (the operator pauses it by hand, runbook 5.11).
 */
export type ExitCode = 0 | 1 | 2 | 3 | 4;
export type KeeperResult = { exitCode: ExitCode; rows: KeeperRow[]; message: string | null };

export const explorerTxUrl = (hash: string) => `https://stellar.expert/explorer/testnet/tx/${hash}`;

export const exitCodeForChainError = (err: ChainError): ExitCode => (err.kind === "timeout" || err.kind === "unknown" ? 2 : 3);

const refuse = (message: string): never => {
  throw new KeeperRefusal(message);
};

/** Refuse unless the contract at `contractId` runs the Wasm with `expectedHash` (not a Stellar Asset Contract, not another Wasm, not missing). */
export async function assertExecutable(server: LedgerRpc, contractId: string, expectedHash: string, what: string): Promise<void> {
  let info;
  try {
    info = await executableOf(server, contractId);
  } catch (err) {
    return refuse(`could not read the executable of ${what} (${contractId}): ${err instanceof Error ? err.message : String(err)}`);
  }
  if (info === null) refuse(`${what} (${contractId}) has no contract instance on chain`);
  else if (info.kind !== "wasm") refuse(`${what} (${contractId}) does not run a Wasm (${info.type})`);
  else if (info.hash !== expectedHash) refuse(`${what} (${contractId}) runs Wasm ${info.hash}, not the expected ${expectedHash}`);
}

/** The one place a keeper transaction is sent. Refuses any call, of any method, to Recon's feed (the constant and the record). */
export async function guardedSend(deps: Pick<KeeperDeps, "send" | "recon">, req: InvokeRequest): Promise<InvokeResult> {
  if (req.contractId === RECON_FEED_ID || req.contractId === deps.recon.contract_id) {
    throw new KeeperRefusal(`refusing to send ${req.method} to Recon's feed ${req.contractId}; the keeper never writes to it`);
  }
  return deps.send(req);
}

/** Spec 4.3 step 1. Throws `KeeperRefusal` with the first failed check; nothing has been signed. */
export async function checkPreconditions(name: MarketName, deps: KeeperDeps): Promise<void> {
  const dep = deps.deployment;
  if ((dep.network as string) !== "testnet") refuse(`deployment.json says network "${String(dep.network)}"; only testnet is allowed`);
  try {
    assertTestnetRpcUrl(deps.rpcUrl, deps.env ?? process.env);
  } catch (err) {
    refuse(err instanceof Error ? err.message : String(err));
  }
  const passphrase = (await deps.rpc.getNetwork()).passphrase;
  if (passphrase !== Networks.TESTNET) refuse(`the RPC reports a network that is not testnet ("${passphrase}")`);

  const problems = checkRecords(dep, deps.scenario, deps.recon, deps.universe);
  if (problems.length > 0) refuse(`the records are not consistent: ${problems.join("; ")}`);

  const rec = dep.markets[name];
  await assertExecutable(deps.rpc, rec.contract_id, dep.lending_wasm_hash, "the market");
  const feed = await deps.market.feed();
  if (feed !== rec.feed) refuse(`the market's feed() is ${feed}, not the record's ${rec.feed}`);
  if (name === "live" && feed !== deps.recon.contract_id) refuse(`the live market reads ${feed}, not Recon's feed ${deps.recon.contract_id}`);
  if (name === "demo" && feed === deps.recon.contract_id) refuse("the demo market reads Recon's feed");
  await assertExecutable(deps.rpc, feed, FEED_WASM_HASH, "the market's feed");
  const admin = await deps.market.admin();
  if (admin !== dep.admin) refuse(`the market's admin() is ${admin}, not the record's ${dep.admin}`);
  const onChain = new Set(await deps.market.markets());
  const listed = new Set(rec.assets.map((a) => a.key));
  if (onChain.size !== listed.size || [...listed].some((k) => !onChain.has(k))) {
    refuse("the market's markets() are not the assets in the record");
  }

  // None of the four keeper accounts may be Recon's publisher or admin, read from Recon's feed on chain.
  const reconRoles = await deps.feedRoles(deps.recon.contract_id);
  for (const [label, key] of [["lending-admin", dep.admin], ["lending-keeper", dep.keeper], ["lending-borrower", dep.borrower], ["demo-feed-writer", dep.demo_feed.writer]] as const) {
    if (key === reconRoles.publisher || key === reconRoles.admin) refuse(`${label} (${key}) is the publisher or admin of Recon's feed on chain`);
  }

  const keeperKey = deps.publicKeyOf(IDENTITIES.keeper);
  if (keeperKey !== dep.keeper) refuse(`identity ${IDENTITIES.keeper} is ${keeperKey}, not the record's keeper ${dep.keeper}`);
  const balance = BigInt(String((await deps.rpc.getAccountEntry(dep.keeper)).balance));
  if (balance < MIN_KEEPER_BALANCE_STROOPS) refuse("the keeper account has too little balance to pay fees; fund it on testnet first");
}

/**
 * Why an off-chain entry differs from the decision's copy of it, or null if they agree.
 * FEED_UNAVAILABLE copies nothing, so there is nothing to compare: the market's own call failed and `sync` can only pause.
 */
export function entryMismatch(d: Decision, entry: Entry | null): string | null {
  if (d.reason === REASON.FEED_UNAVAILABLE) return null;
  if (d.reason === REASON.NOT_COVERED) {
    return entry === null ? null : `the market says ${reasonName(d.reason)} but the feed holds an entry`;
  }
  if (entry === null) return `the market holds a decision from an entry (${reasonName(d.reason)}) but the feed has none`;
  const diffs: string[] = [];
  if (entry.status !== d.status) diffs.push(`status ${entry.status} != ${d.status}`);
  if (entry.flags !== d.flags) diffs.push(`flags ${entry.flags} != ${d.flags}`);
  if (entry.as_of !== d.as_of) diffs.push(`as_of ${entry.as_of} != ${d.as_of}`);
  if (entry.evidence_hash !== d.evidence_hash) diffs.push("evidence_hash differs");
  if (entry.published_ledger !== d.published_ledger) diffs.push(`published_ledger ${entry.published_ledger} != ${d.published_ledger}`);
  return diffs.length === 0 ? null : `the feed entry differs from the market's decision: ${diffs.join(", ")}`;
}

export const formatAge = (seconds: number): string => {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3_600);
  const m = Math.floor((s % 3_600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
};

const stateWord = (s: MarketState) => (s.borrow_enabled ? "open" : "paused");

/** One table row (spec 4.3 step 5). Demo rows start with SYNTHETIC. */
export function formatRow(market: MarketName, row: KeeperRow, now: Date): string {
  const d = row.decision;
  const feedPart = d.reason === REASON.NOT_COVERED || d.reason === REASON.FEED_UNAVAILABLE
    ? "feed status none"
    : `feed status ${feedStatusName(d.status)} (flags ${d.flags}), as_of ${new Date(Number(d.as_of) * 1000).toISOString()} (age ${formatAge(now.getTime() / 1000 - Number(d.as_of))})`;
  const parts = [
    `${market === "demo" ? "SYNTHETIC " : ""}${row.label}`,
    feedPart,
    `market policy ${reasonName(d.reason)}`,
    `${stateWord(row.before)} → ${stateWord(row.after)}`,
  ];
  if (row.txHash) parts.push(explorerTxUrl(row.txHash));
  else if (row.action === "dry-run") parts.push("dry run: simulated, not sent");
  else parts.push("no transaction");
  return parts.join(" | ");
}

const RUNBOOK = "follow runbook 5.11: lending-admin runs pause_borrows";
/** The line printed (and the reason for exit 4) when an asset could not be evaluated and its market may be open. */
export const couldNotEvaluate = (label: string) => `could not evaluate ${label}; the market may be open; ${RUNBOOK}`;

type LogBase = { decision: Decision; before: MarketState; txHash: string };
type LogExtra = { ledger: number | null; afterEnabled: boolean | null; outcome?: "unknown" | "failed" };

const logRecord = (opts: KeeperOptions, deps: KeeperDeps, label: string, key: string, base: LogBase, extra: LogExtra): KeeperLogRecord => ({
  at: deps.now().toISOString(),
  network: "testnet",
  market: opts.market,
  contract_id: deps.deployment.markets[opts.market].contract_id,
  method: "sync",
  asset_label: label,
  key,
  tx_hash: base.txHash,
  ledger: extra.ledger,
  decision: decisionToJson(base.decision, reasonName),
  borrow_enabled_before: base.before.borrow_enabled,
  borrow_enabled_after: extra.afterEnabled,
  ...(extra.outcome ? { outcome: extra.outcome } : {}),
});

export async function runKeeper(opts: KeeperOptions, deps: KeeperDeps): Promise<KeeperResult> {
  const { out } = deps;
  const rec = deps.deployment.markets[opts.market];
  const rows: KeeperRow[] = [];
  const planned: { label: string; key: string; decision: Decision; before: MarketState }[] = [];
  const views: { label: string; key: string; decision: Decision; state: MarketState }[] = [];
  /** Lines for assets that could not be evaluated while their market is open or unknown (exit 4). */
  const unevaluated: string[] = [];

  // 1 and 2. Preconditions (exit 1), then each asset's state, decision and off-chain entry. Nothing is signed here.
  try {
    await checkPreconditions(opts.market, deps);
    for (const a of rec.assets) {
      let state: MarketState | null = null;
      let stateKnown = false;
      try {
        state = await deps.market.market(a.key);
        stateKnown = true;
      } catch {
        stateKnown = false;
      }
      let decision: Decision | null = null;
      try {
        decision = await deps.market.check(a.key);
      } catch {
        decision = null;
      }
      if (stateKnown && state === null) refuse(`${a.label} is not listed in the market`);
      if (decision === null || state === null) {
        // check() or market() failed: the asset can't be judged here. A market known to be paused needs nothing; otherwise the operator acts.
        if (state !== null && !state.borrow_enabled) out(`could not evaluate ${a.label}; the market is paused`);
        else unevaluated.push(couldNotEvaluate(a.label));
        continue;
      }
      let entry: Entry | null = null;
      let readFailed = false;
      try {
        [entry] = await deps.readEntries(rec.feed, [a.key]);
      } catch {
        readFailed = true;
      }
      if (readFailed) {
        // An off-chain read or decoding error cannot veto a pause: sync is evaluated on chain and can only pause.
        // With reason CLEAR nothing is planned, so an unreadable entry means the cross-check could not be made.
        if (decision.reason === REASON.CLEAR) {
          if (state.borrow_enabled) unevaluated.push(couldNotEvaluate(a.label));
          else out(`could not evaluate ${a.label}; the market is paused`);
          continue;
        }
      } else {
        const mismatch = entryMismatch(decision, entry);
        if (mismatch) refuse(`${a.label}: ${mismatch}`);
      }
      views.push({ label: a.label, key: a.key, decision, state });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    out(`Refused: ${message}`);
    return { exitCode: 1, rows, message };
  }

  // 3. Plan: sync only where the policy says pause and the market is still open; --send-all sends for every asset.
  out(`Keeper run: ${opts.market} market ${rec.contract_id}${opts.dryRun ? " (dry run: nothing is signed)" : ""}`);
  for (const v of views) {
    if (opts.sendAll || (v.decision.reason !== REASON.CLEAR && v.state.borrow_enabled)) planned.push({ label: v.label, key: v.key, decision: v.decision, before: v.state });
  }

  const finish = (exitCode: ExitCode, message: string | null): KeeperResult => {
    for (const r of rows) out(formatRow(opts.market, r, deps.now()));
    if (opts.market === "live" && deps.notEvaluated) {
      for (const r of rows) {
        const ne = deps.notEvaluated(r.key);
        if (ne) out(`  ${r.label} not evaluated (from the status file ${ne.file}, not on chain): ${ne.flags.length > 0 ? ne.flags.join(", ") : "none"}`);
      }
    }
    if (message) out(message);
    return { exitCode, rows, message };
  };
  const stopMessage = (text: string, open: boolean) => (open ? `${text}. The market may be open; ${RUNBOOK}` : text);

  // 4. Send one transaction at a time, re-read the state, and log each one as soon as it is known.
  for (const v of views) {
    const p = planned.find((x) => x.key === v.key);
    if (!p) {
      rows.push({ label: v.label, key: v.key, decision: v.decision, before: v.state, after: v.state, txHash: null, ledger: null, events: null, action: "none" });
      continue;
    }
    const req = {
      contractId: rec.contract_id, method: "sync", args: [addressToScVal(p.key)], source: deps.deployment.keeper, errorNames: MARKET_ERROR_NAMES,
    };
    if (opts.dryRun) {
      try {
        await deps.simulate(req);
      } catch (err) {
        if (p.before.borrow_enabled) {
          unevaluated.push(couldNotEvaluate(p.label));
          continue;
        }
        return finish(3, `Dry run: the simulation of sync for ${p.label} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      rows.push({ label: p.label, key: p.key, decision: p.decision, before: p.before, after: p.before, txHash: null, ledger: null, events: null, action: "dry-run" });
      continue;
    }
    let sent: InvokeResult;
    try {
      sent = await guardedSend(deps, { ...req, identity: IDENTITIES.keeper });
    } catch (err) {
      if (err instanceof KeeperRefusal) return finish(1, `Refused: ${err.message}`);
      if (!(err instanceof ChainError)) throw err;
      const base = { decision: p.decision, before: p.before, txHash: err.txHash as string };
      if (err.txHash && (err.kind === "timeout" || err.kind === "unknown")) {
        deps.appendLog(logRecord(opts, deps, p.label, p.key, base, { ledger: null, afterEnabled: null, outcome: "unknown" }));
        return finish(2, `OUTCOME UNKNOWN for transaction ${err.txHash}: look it up on the explorer (${explorerTxUrl(err.txHash)}) before running again.`);
      }
      if (err.txHash && err.kind === "failed" && err.ledger === null) {
        // Included on chain as FAILED: a real transaction with a hash, so it is logged.
        deps.appendLog(logRecord(opts, deps, p.label, p.key, base, { ledger: null, afterEnabled: null, outcome: "failed" }));
      }
      return finish(exitCodeForChainError(err), stopMessage(`Stopped: sync for ${p.label} failed: ${err.message}${err.txHash ? ` (transaction ${err.txHash})` : ""}`, p.before.borrow_enabled));
    }
    // The transaction is final. Re-read the state in its own guard so a failed read never loses the hash.
    let after: MarketState | null = null;
    try {
      after = await deps.market.market(p.key);
    } catch {
      after = null;
    }
    const base = { decision: p.decision, before: p.before, txHash: sent.txHash };
    if (after === null) {
      deps.appendLog(logRecord(opts, deps, p.label, p.key, base, { ledger: sent.ledger, afterEnabled: null }));
      return finish(3, `Transaction ${sent.txHash} succeeded in ledger ${sent.ledger} but the state of ${p.label} could not be re-read afterwards (${explorerTxUrl(sent.txHash)}). Check it before running again.`);
    }
    const row: KeeperRow = { label: p.label, key: p.key, decision: p.decision, before: p.before, after, txHash: sent.txHash, ledger: sent.ledger, events: sent.events, action: "sync" };
    rows.push(row);
    deps.appendLog(logRecord(opts, deps, p.label, p.key, base, { ledger: sent.ledger, afterEnabled: after.borrow_enabled }));
  }
  if (unevaluated.length > 0) {
    for (const r of rows) out(formatRow(opts.market, r, deps.now()));
    for (const line of unevaluated) out(line);
    return { exitCode: 4, rows, message: unevaluated.join("\n") };
  }
  return finish(0, null);
}

/** Display only: the flags the newest status file did not evaluate for a key. Read from disk; never a decision input. */
export function notEvaluatedFromStatus(statusDir: string, key: string): { file: string; flags: string[] } | null {
  if (!fs.existsSync(statusDir)) return null;
  const files = fs.readdirSync(statusDir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().reverse();
  for (const f of files) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(path.join(statusDir, f), "utf8"));
    } catch {
      continue;
    }
    const assets = (parsed as { assets?: unknown } | null)?.assets;
    if (!Array.isArray(assets)) continue;
    const row = assets.find((a) => (a as { sac_contract_id?: unknown } | null)?.sac_contract_id === key) as { not_evaluated?: unknown } | undefined;
    if (!row) continue;
    const list = Array.isArray(row.not_evaluated) ? row.not_evaluated : [];
    const flags = list.map((x) => (x as { flag?: unknown } | null)?.flag).filter((x): x is string => typeof x === "string" && /^[A-Z_]{1,40}$/.test(x));
    return { file: f, flags };
  }
  return null;
}
