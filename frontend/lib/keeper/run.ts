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
import { assertTestnetRpcUrl, type FeedRpc } from "../feed/reader";
import { decisionToJson, type KeeperLogRecord } from "./log";
import {
  ChainError, MARKET_ERROR_NAMES, REASON, addressToScVal, feedStatusName, reasonName,
  type Decision, type MarketReader, type MarketState,
} from "./market";
import {
  IDENTITIES, checkRecords,
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
  rpc: Pick<FeedRpc, "getNetwork" | "getAccountEntry">;
  /** Reader of the market selected in `opts.market`. */
  market: MarketReader;
  /** Entries of a feed by key, by simulation. */
  readEntries(feedContractId: string, keys: readonly string[]): Promise<(Entry | null)[]>;
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

/** 0 done; 1 refused (nothing signed); 2 a transaction outcome unknown; 3 a transaction failed. */
export type ExitCode = 0 | 1 | 2 | 3;
export type KeeperResult = { exitCode: ExitCode; rows: KeeperRow[]; message: string | null };

export const explorerTxUrl = (hash: string) => `https://stellar.expert/explorer/testnet/tx/${hash}`;

export const exitCodeForChainError = (err: ChainError): ExitCode => (err.kind === "timeout" || err.kind === "unknown" ? 2 : 3);

const refuse = (message: string): never => {
  throw new KeeperRefusal(message);
};

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
  const feed = await deps.market.feed();
  if (feed !== rec.feed) refuse(`the market's feed() is ${feed}, not the record's ${rec.feed}`);
  if (name === "live" && feed !== deps.recon.contract_id) refuse(`the live market reads ${feed}, not Recon's feed ${deps.recon.contract_id}`);
  if (name === "demo" && feed === deps.recon.contract_id) refuse("the demo market reads Recon's feed");
  const admin = await deps.market.admin();
  if (admin !== dep.admin) refuse(`the market's admin() is ${admin}, not the record's ${dep.admin}`);
  const onChain = new Set(await deps.market.markets());
  const listed = new Set(rec.assets.map((a) => a.key));
  if (onChain.size !== listed.size || [...listed].some((k) => !onChain.has(k))) {
    refuse("the market's markets() are not the assets in the record");
  }

  const keeperKey = deps.publicKeyOf(IDENTITIES.keeper);
  if (keeperKey !== dep.keeper) refuse(`identity ${IDENTITIES.keeper} is ${keeperKey}, not the record's keeper ${dep.keeper}`);
  const balance = BigInt(String((await deps.rpc.getAccountEntry(dep.keeper)).balance));
  if (balance < MIN_KEEPER_BALANCE_STROOPS) refuse("the keeper account has too little balance to pay fees; fund it on testnet first");
}

/** Why an off-chain entry differs from the decision's copy of it, or null if they agree. */
export function entryMismatch(d: Decision, entry: Entry | null): string | null {
  if (d.reason === REASON.NOT_COVERED || d.reason === REASON.FEED_UNAVAILABLE) {
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

const logRecord = (opts: KeeperOptions, deps: KeeperDeps, label: string, key: string, row: Omit<KeeperRow, "label" | "key" | "action" | "events">, outcomeUnknown: boolean): KeeperLogRecord => ({
  at: deps.now().toISOString(),
  network: "testnet",
  market: opts.market,
  contract_id: deps.deployment.markets[opts.market].contract_id,
  method: "sync",
  asset_label: label,
  key,
  tx_hash: row.txHash as string,
  ledger: outcomeUnknown ? null : row.ledger,
  decision: decisionToJson(row.decision, reasonName),
  borrow_enabled_before: row.before.borrow_enabled,
  borrow_enabled_after: outcomeUnknown ? null : row.after.borrow_enabled,
  ...(outcomeUnknown ? { outcome: "unknown" as const } : {}),
});

export async function runKeeper(opts: KeeperOptions, deps: KeeperDeps): Promise<KeeperResult> {
  const { out } = deps;
  const rec = deps.deployment.markets[opts.market];
  const rows: KeeperRow[] = [];
  const planned: { label: string; key: string; decision: Decision; before: MarketState }[] = [];
  const views: { label: string; key: string; decision: Decision; state: MarketState }[] = [];

  // 1 and 2. Preconditions, then each asset's decision, state and off-chain entry. Nothing is signed here.
  try {
    await checkPreconditions(opts.market, deps);
    for (const a of rec.assets) {
      const decision = await deps.market.check(a.key);
      const state = await deps.market.market(a.key);
      if (state === null) refuse(`${a.label} is not listed in the market`);
      const [entry] = await deps.readEntries(rec.feed, [a.key]);
      const mismatch = entryMismatch(decision, entry);
      if (mismatch) refuse(`${a.label}: ${mismatch}`);
      views.push({ label: a.label, key: a.key, decision, state: state as MarketState });
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
        const message = `Dry run: the simulation of sync for ${p.label} failed: ${err instanceof Error ? err.message : String(err)}`;
        return finish(3, message);
      }
      rows.push({ label: p.label, key: p.key, decision: p.decision, before: p.before, after: p.before, txHash: null, ledger: null, events: null, action: "dry-run" });
      continue;
    }
    try {
      const sent = await deps.send({ ...req, identity: IDENTITIES.keeper });
      const after = await deps.market.market(p.key);
      if (after === null) throw new ChainError(`${p.label} is no longer listed after the sync (transaction ${sent.txHash})`, "failed", null, null, sent.txHash, sent.ledger);
      const row: KeeperRow = { label: p.label, key: p.key, decision: p.decision, before: p.before, after, txHash: sent.txHash, ledger: sent.ledger, events: sent.events, action: "sync" };
      rows.push(row);
      deps.appendLog(logRecord(opts, deps, p.label, p.key, row, false));
    } catch (err) {
      if (!(err instanceof ChainError)) throw err;
      if (err.txHash && (err.kind === "timeout" || err.kind === "unknown")) {
        deps.appendLog(logRecord(opts, deps, p.label, p.key, { decision: p.decision, before: p.before, after: p.before, txHash: err.txHash, ledger: null }, true));
        return finish(2, `OUTCOME UNKNOWN for transaction ${err.txHash}: look it up on the explorer (${explorerTxUrl(err.txHash)}) before running again.`);
      }
      if (err.txHash && err.ledger !== null) {
        // Confirmed on chain although the follow-up read failed: record it first.
        const row: KeeperRow = { label: p.label, key: p.key, decision: p.decision, before: p.before, after: p.before, txHash: err.txHash, ledger: err.ledger, events: null, action: "sync" };
        deps.appendLog(logRecord(opts, deps, p.label, p.key, row, false));
        rows.push(row);
      }
      return finish(exitCodeForChainError(err), `Stopped: sync for ${p.label} failed: ${err.message}${err.txHash ? ` (transaction ${err.txHash})` : ""}`);
    }
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
