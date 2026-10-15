/**
 * The scripted end-to-end demo of the CRITICAL path (spec 4.5), on the demo market and the separate demo
 * feed only. The demo feed holds one synthetic testnet key, SYNTH; its entries are test data, not a Recon
 * finding. The code refuses any `publish` to Recon's feed. Testnet only; no LLM; signing is `cli-signer.ts`.
 *
 * Node runtime only. Nothing under `app/` or `agent/` may import this file.
 */
import { nativeToScVal } from "@stellar/stellar-sdk";
import { FEED_ERROR_NAMES, entryMatches, updatesToScVal, type Update } from "../feed/encode";
import { decisionToJson, type KeeperLogRecord } from "./log";
import {
  ChainError, ERROR_CODE, MARKET_ERROR_NAMES, REASON, addressToScVal, reasonName,
  type ErrorNames, type MarketState,
} from "./market";
import { FEED_WASM_HASH, IDENTITIES, demoEvidenceHash, type KeeperDeployment, type ReconFeedRecord, type ScenarioStepId } from "./records";
import {
  KeeperRefusal, assertExecutable, checkPreconditions, exitCodeForChainError, explorerTxUrl, guardedSend, runKeeper,
  type ExitCode, type KeeperDeps,
} from "./run";
import type { InvokeResult } from "./send";

export type DemoOptions = { dryRun: boolean; fromStep: number };

export type DemoDeps = KeeperDeps & {
  /** SHA-256 of the scenario file text. */
  scenarioSha256: string;
  sleep(ms: number): Promise<void>;
};

export type DemoStepRow = { step: number; signer: string; result: string; txHash: string | null };
export type DemoResult = { exitCode: ExitCode; steps: DemoStepRow[]; message: string | null };

/** The demo failed an expectation (not a refusal, not a chain error). */
class StepFailure extends Error {}

const expectThat = (cond: boolean, message: string): void => {
  if (!cond) throw new StepFailure(message);
};

/** Refuses any `publish` target but the demo feed, and always Recon's feed. */
export function assertPublishTarget(contractId: string, dep: KeeperDeployment, recon: ReconFeedRecord): void {
  if (contractId === recon.contract_id) throw new KeeperRefusal("refusing to publish to Recon's feed; the demo writes to the demo feed only");
  if (contractId !== dep.demo_feed.contract_id) throw new KeeperRefusal(`refusing to publish to ${contractId}: it is not the demo feed`);
}

/** The first `as_of` (unix seconds) from the clock that is strictly above the stored one; waits 1 s at a time. */
export async function nextAsOf(clock: { now(): Date; sleep(ms: number): Promise<void> }, stored: bigint | null): Promise<bigint> {
  for (let tries = 0; tries < 10; tries++) {
    const now = BigInt(Math.floor(clock.now().getTime() / 1000));
    if (stored === null || now > stored) return now;
    await clock.sleep(1000);
  }
  throw new KeeperRefusal(`the stored as_of ${stored} is ahead of the clock; not publishing`);
}

/** Guards before step 1 (spec 4.5). Throws `KeeperRefusal`; nothing has been signed. */
export async function checkDemoGuards(deps: DemoDeps): Promise<void> {
  await checkPreconditions("demo", deps);
  const dep = deps.deployment;
  const feedId = dep.demo_feed.contract_id;
  const writer = dep.demo_feed.writer;
  const synth = dep.markets.demo.assets[0].key;

  await assertExecutable(deps.rpc, feedId, FEED_WASM_HASH, "the demo feed");
  const roles = await deps.feedRoles(feedId);
  if (roles.publisher === deps.recon.publisher || roles.admin === deps.recon.admin) throw new KeeperRefusal("the demo feed's publisher or admin is Recon's");
  if (roles.publisher !== writer) throw new KeeperRefusal(`the demo feed's publisher() is ${roles.publisher}, not the writer ${writer}`);
  if (roles.admin !== writer) throw new KeeperRefusal(`the demo feed's admin() is ${roles.admin}, not the writer ${writer}`);

  const held = await deps.feedAssets(feedId);
  if (held.length > 1 || (held.length === 1 && held[0] !== synth)) throw new KeeperRefusal("the demo feed holds a key other than the synthetic one");
  if ((await deps.feedAssets(deps.recon.contract_id)).includes(synth)) throw new KeeperRefusal("Recon's feed holds the synthetic key");

  for (const [identity, expected] of [
    [IDENTITIES.admin, dep.admin], [IDENTITIES.keeper, dep.keeper], [IDENTITIES.borrower, dep.borrower], [IDENTITIES.writer, writer],
  ] as const) {
    const actual = deps.publicKeyOf(identity);
    if (actual !== expected) throw new KeeperRefusal(`identity ${identity} is ${actual}, not the record's ${expected}`);
  }
}

const normalizeEvent = (name: string) => name.replace(/_/g, "").toLowerCase();

export async function runDemo(opts: DemoOptions, deps: DemoDeps): Promise<DemoResult> {
  const { out } = deps;
  const dep = deps.deployment;
  const steps: DemoStepRow[] = [];
  const marketRec = dep.markets.demo;
  const synth = marketRec.assets[0].key;
  const label = marketRec.assets[0].label;
  const feedId = dep.demo_feed.contract_id;
  const marketId = marketRec.contract_id;

  const finish = (exitCode: ExitCode, message: string | null): DemoResult => {
    out("Step | signer | result | transaction");
    for (const s of steps) out(`${s.step} | ${s.signer} | ${s.result} | ${s.txHash ? explorerTxUrl(s.txHash) : "none"}`);
    if (message) out(message);
    return { exitCode, steps, message };
  };

  try {
    await checkDemoGuards(deps);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    out(`Refused: ${message}`);
    return { exitCode: 1, steps, message };
  }
  out(`SYNTHETIC demo: ${label}, key ${synth}`);
  out("The demo feed holds test data written by the demo writer. It is not Recon's feed and names no real asset.");

  const stateOf = async (): Promise<MarketState> => {
    const s = await deps.market.market(synth);
    if (s === null) throw new KeeperRefusal(`${label} is not listed in the demo market`);
    return s;
  };

  /** Send one market or feed call, log it, and record the step row. */
  async function tx(
    step: number, signer: string, identity: string, source: string, contractId: string, method: string,
    args: Parameters<DemoDeps["send"]>[0]["args"], errorNames: ErrorNames, withDecision: boolean,
  ): Promise<InvokeResult> {
    const decision = withDecision ? await deps.market.check(synth) : null;
    const before = withDecision ? await stateOf() : null;
    let sent: InvokeResult;
    try {
      // Every demo send goes through guardedSend, which refuses Recon's feed for any method.
      sent = await guardedSend(deps, { contractId, method, args, source, identity, errorNames });
    } catch (err) {
      if (err instanceof ChainError && err.txHash && (err.kind === "timeout" || err.kind === "unknown")) {
        deps.appendLog(record(step, contractId, method, err.txHash, null, decision, before, null, "unknown"));
        steps.push({ step, signer, result: `${method}: outcome unknown`, txHash: err.txHash });
      } else if (err instanceof ChainError && err.txHash && err.kind === "failed" && err.ledger === null) {
        deps.appendLog(record(step, contractId, method, err.txHash, null, decision, before, null, "failed"));
        steps.push({ step, signer, result: `${method}: failed on chain`, txHash: err.txHash });
      }
      throw err;
    }
    // The transaction is final: log it at once; a failed re-read of the state must not lose the hash.
    let after: MarketState | null = null;
    if (withDecision) {
      try {
        after = await stateOf();
      } catch {
        deps.appendLog(record(step, contractId, method, sent.txHash, sent.ledger, decision, before, null, undefined));
        steps.push({ step, signer, result: method, txHash: sent.txHash });
        throw new ChainError(`Transaction ${sent.txHash} succeeded in ledger ${sent.ledger} but the market state could not be re-read afterwards`, "failed", null, null, sent.txHash, sent.ledger);
      }
    }
    deps.appendLog(record(step, contractId, method, sent.txHash, sent.ledger, decision, before, after, undefined));
    steps.push({ step, signer, result: method, txHash: sent.txHash });
    return sent;
  }

  const record = (
    step: number, contractId: string, method: string, txHash: string, ledger: number | null,
    decision: Awaited<ReturnType<DemoDeps["market"]["check"]>> | null, before: MarketState | null, after: MarketState | null, outcome: "unknown" | "failed" | undefined,
  ): KeeperLogRecord => ({
    at: deps.now().toISOString(), network: "testnet", market: "demo", contract_id: contractId, method, asset_label: label, key: synth,
    tx_hash: txHash, ledger, decision: decision ? decisionToJson(decision, reasonName) : null,
    borrow_enabled_before: before ? before.borrow_enabled : null, borrow_enabled_after: after ? after.borrow_enabled : null,
    step, ...(outcome ? { outcome } : {}),
  });

  const expectError = async (step: number, signer: string, method: string, source: string, args: Parameters<DemoDeps["send"]>[0]["args"], code: number) => {
    let error: ChainError | null = null;
    try {
      await deps.simulate({ contractId: marketId, method, args, source, errorNames: MARKET_ERROR_NAMES });
    } catch (err) {
      if (!(err instanceof ChainError)) throw err;
      error = err;
    }
    expectThat(error !== null, `step ${step}: ${method} should have been refused but the simulation succeeded`);
    expectThat((error as ChainError).code === code, `step ${step}: ${method} gave "${(error as ChainError).message}", expected contract error #${code} (${MARKET_ERROR_NAMES[code]})`);
    steps.push({ step, signer, result: `${method} refused: ${(error as ChainError).message}; nothing sent`, txHash: null });
  };

  const publish = async (step: number, id: ScenarioStepId) => {
    assertPublishTarget(feedId, dep, deps.recon);
    const spec = deps.scenario.steps.find((s) => s.id === id);
    if (!spec) throw new KeeperRefusal(`scenario.json has no step "${id}"`);
    const [stored] = await deps.readEntries(feedId, [synth]);
    const asOf = await nextAsOf({ now: deps.now, sleep: deps.sleep }, stored ? stored.as_of : null);
    const update: Update = {
      asset: synth, status: spec.status, flags: spec.flags, evidence_hash: demoEvidenceHash(deps.scenarioSha256, id, asOf), as_of: asOf, issuer_change_seen_at: 0n,
    };
    await tx(step, "writer", IDENTITIES.writer, dep.demo_feed.writer, feedId, "publish", [updatesToScVal([update])], FEED_ERROR_NAMES, false);
    const [written] = await deps.readEntries(feedId, [synth]);
    expectThat(written !== null, `step ${step}: the demo feed has no entry after publish`);
    const diffs = entryMatches(written as NonNullable<typeof written>, update);
    expectThat(diffs.length === 0, `step ${step}: the entry differs from what was sent (${diffs.join(", ")})`);
    steps[steps.length - 1].result = `publish [${id}] feed status ${["OK", "WARNING", "CRITICAL"][spec.status]}`;
  };

  const resume = async (step: number) => {
    await tx(step, "admin", IDENTITIES.admin, dep.admin, marketId, "resume_borrows", [addressToScVal(synth)], MARKET_ERROR_NAMES, true);
    const s = await stateOf();
    expectThat(s.borrow_enabled && s.reason === REASON.CLEAR, `step ${step}: the market is not open after resume_borrows`);
    steps[steps.length - 1].result = "resume_borrows: open";
  };

  const borrow = async (step: number) => {
    const before = await stateOf();
    await tx(step, "borrower", IDENTITIES.borrower, dep.borrower, marketId, "open_borrow",
      [addressToScVal(dep.borrower), addressToScVal(synth), nativeToScVal(1n, { type: "i128" })], MARKET_ERROR_NAMES, true);
    const after = await stateOf();
    expectThat(after.total_borrowed === before.total_borrowed + 1n, `step ${step}: total_borrowed did not grow by 1 mock unit`);
    steps[steps.length - 1].result = "open_borrow 1 mock unit";
  };

  const runKeeperStep = async (step: number): Promise<ExitCode | { row: Awaited<ReturnType<typeof runKeeper>>["rows"][number] }> => {
    const result = await runKeeper({ market: "demo", dryRun: false, sendAll: false }, { ...deps, appendLog: (r) => deps.appendLog({ ...r, step }) });
    if (result.exitCode !== 0) return result.exitCode;
    const row = result.rows[0];
    expectThat(row !== undefined, `step ${step}: the keeper returned no row`);
    return { row };
  };

  const from = (n: number) => opts.fromStep <= n;
  try {
    // Step 0: a known start state.
    const start = await stateOf();
    if (opts.dryRun) {
      out(`Dry run: step 0 would ${start.borrow_enabled ? "pause the open market (admin pause_borrows)" : "find the market already paused"}.`);
    } else if (from(0) && start.borrow_enabled) {
      await tx(0, "admin", IDENTITIES.admin, dep.admin, marketId, "pause_borrows", [addressToScVal(synth)], MARKET_ERROR_NAMES, true);
      const s = await stateOf();
      expectThat(!s.borrow_enabled && s.reason === REASON.MANUAL, "step 0: the market is not paused (MANUAL) after pause_borrows");
      steps[steps.length - 1].result = "pause_borrows: paused (MANUAL)";
    }

    // Step 1: before any entry, resume is refused (first run only).
    const [existing] = await deps.readEntries(feedId, [synth]);
    if ((opts.dryRun || from(1)) && existing === null) {
      await expectError(1, "admin", "resume_borrows", dep.admin, [addressToScVal(synth)], ERROR_CODE.PolicyBlocks);
      const d = await deps.market.check(synth);
      expectThat(d.reason === REASON.NOT_COVERED, `step 1: check gave ${reasonName(d.reason)}, expected NOT_COVERED`);
      steps[steps.length - 1].result += "; check NOT_COVERED";
    } else if (existing !== null) {
      steps.push({ step: 1, signer: "-", result: "skipped (the demo feed already has an entry)", txHash: null });
    }
    if (opts.dryRun) return finish(0, "Dry run: stopped after step 1; nothing was signed or sent.");

    if (from(2)) await publish(2, "open");
    if (from(3)) await resume(3);
    if (from(4)) await borrow(4);
    if (from(5)) await publish(5, "critical");
    if (from(6)) {
      const r = await runKeeperStep(6);
      if (typeof r === "number") return finish(r, `Stopped at step 6 (the keeper). Rerun with --from-step 6 after checking the state.`);
      expectThat(r.row.decision.reason === REASON.STATUS, `step 6: the market policy was ${reasonName(r.row.decision.reason)}, expected STATUS`);
      expectThat(r.row.txHash !== null && !r.row.after.borrow_enabled && r.row.after.reason === REASON.STATUS, "step 6: the market is not paused with reason STATUS after sync");
      if (r.row.events !== null) expectThat(r.row.events.some((e) => normalizeEvent(e) === "borrowspaused"), "step 6: the transaction has no BorrowsPaused event");
      steps.push({ step: 6, signer: "keeper", result: "sync: paused, market policy STATUS, BorrowsPaused event", txHash: r.row.txHash });
    }
    if (from(7)) await expectError(7, "borrower", "open_borrow", dep.borrower, [addressToScVal(dep.borrower), addressToScVal(synth), nativeToScVal(1n, { type: "i128" })], ERROR_CODE.BorrowsPaused);
    if (from(8)) await expectError(8, "admin", "resume_borrows", dep.admin, [addressToScVal(synth)], ERROR_CODE.PolicyBlocks);
    if (from(9)) await publish(9, "clean");
    if (from(10)) {
      const r = await runKeeperStep(10);
      if (typeof r === "number") return finish(r, `Stopped at step 10 (the keeper). Rerun with --from-step 10 after checking the state.`);
      expectThat(r.row.decision.reason === REASON.CLEAR, `step 10: the market policy was ${reasonName(r.row.decision.reason)}, expected CLEAR`);
      expectThat(r.row.txHash === null && !r.row.after.borrow_enabled, "step 10: the market should stay paused with no transaction (sync never resumes)");
      steps.push({ step: 10, signer: "keeper", result: "market policy CLEAR; stays paused; no transaction", txHash: null });
    }
    if (from(11)) await resume(11);
    if (from(12)) await borrow(12);
  } catch (err) {
    if (err instanceof ChainError) return finish(exitCodeForChainError(err), `Stopped: ${err.message}${err.txHash ? ` (transaction ${err.txHash})` : ""}. Check the state, then rerun with --from-step N.`);
    if (err instanceof StepFailure) return finish(3, `Stopped: ${err.message}. Check the state, then rerun with --from-step N.`);
    if (err instanceof KeeperRefusal) return finish(1, `Refused: ${err.message}`);
    throw err;
  }
  return finish(0, "Demo finished. Every row above that starts a transaction links to it on testnet; the data is SYNTHETIC test data.");
}
