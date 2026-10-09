/**
 * The publisher (spec 8.1). `runPublish` checks every precondition, then sends the status file
 * to the feed contract in batches. The status and flags come only from the committed status file
 * that `lib/flags` wrote (golden rule 1); nothing here decides them. Testnet only (golden rule 6).
 *
 * Node runtime only. Nothing under `agent/` or `app/api/agent` may import this file.
 */
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { Networks, type Keypair } from "@stellar/stellar-sdk";
import { sha256Hex } from "../documents/store";
import { FEED_SCHEMA } from "../flags/types";
import type { FeedClient } from "./client";
import type { Deployment } from "./deployment";
import { FeedError, MAX_BATCH, fileFieldsOf, parseStatusFile, toUpdate, checkIntegrity, type Update, type StatusFile } from "./encode";
import { formatVerifyTable, verifyFile, type VerifyRow } from "./verify";

/** The publisher needs XLM for fees and rent; below this it stops with a clear message. */
export const MIN_BALANCE_STROOPS = 50_000_000n; // 5 XLM

/** A precondition from spec 8.1 failed: nothing was sent. */
export class PreconditionError extends Error {
  constructor(readonly precondition: number, message: string) {
    super(message);
    this.name = "PreconditionError";
  }
}

export type Git = {
  isTracked(relPath: string): boolean;
  isModified(relPath: string): boolean;
  head(): string;
};

/** Git as the shell sees it, from the repository root. */
export function shellGit(repoRoot: string): Git {
  const run = (args: string[]) => execFileSync("git", ["-C", repoRoot, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return {
    isTracked(rel) {
      try {
        run(["ls-files", "--error-unmatch", "--", rel]);
        return true;
      } catch {
        return false;
      }
    },
    isModified: (rel) => run(["status", "--porcelain", "--", rel]).trim() !== "",
    head: () => run(["rev-parse", "HEAD"]).trim(),
  };
}

export type LogAsset = { asset: string; sac_contract_id: string; status: number; flags: number; evidence_hash: string; as_of: number };
export type LogRecord = {
  at: string;
  network: "testnet";
  contract_id: string;
  tx_hash: string;
  ledger: number;
  status_file: string;
  status_sha256: string;
  commit: string;
  assets: LogAsset[];
};

/** Append one record to the log (a JSON array), writing atomically. */
export function appendLogFile(file: string, record: LogRecord): void {
  let list: unknown[] = [];
  if (fs.existsSync(file)) {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Array.isArray(parsed)) throw new Error("data/feed/log.json must be a JSON array");
    list = parsed;
  }
  list.push(record);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

export const chunk = <T>(items: readonly T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

export type PublishOptions = {
  /** Repo-relative path of the status file, e.g. `data/status/2026-10-08.json`. */
  statusPath: string;
  dryRun: boolean;
  batchSize: number;
};

export type PublishDeps = {
  deployment: Deployment;
  rpcUrl: string;
  client: FeedClient;
  /** The agent wallet's keypair (from `agent/wallet.ts`), or null if there is none. Never printed. */
  keypair: Keypair | null;
  git: Git;
  /** Contents of a repo-relative file. */
  readFile(relPath: string): string;
  appendLog(record: LogRecord): void;
  now(): Date;
  out(line: string): void;
};

export type PublishSummary = {
  dryRun: boolean;
  /** Entries sent (or, in a dry run, simulated) without error. */
  published: string[];
  skipped: string[];
  unpublished: string[];
  txHashes: string[];
  failure: FeedError | null;
  verify: VerifyRow[] | null;
  /** True when nothing failed and the final verify (if any) has no mismatch. */
  ok: boolean;
};

const STATUS_FILE_NAME = /^data\/status\/\d{4}-\d{2}-\d{2}\.json$/;

export async function runPublish(opts: PublishOptions, deps: PublishDeps): Promise<PublishSummary> {
  const { deployment, client, git, out } = deps;
  if (!Number.isInteger(opts.batchSize) || opts.batchSize < 1 || opts.batchSize > MAX_BATCH) {
    throw new Error(`--batch-size must be a whole number from 1 to ${MAX_BATCH}`);
  }

  // 1. Network: testnet in the deployment record, an https RPC, and the testnet passphrase.
  if (deployment.network !== "testnet") throw new PreconditionError(1, `deployment.json says network "${String(deployment.network)}"; only testnet is allowed`);
  if (new URL(deps.rpcUrl).protocol !== "https:") throw new PreconditionError(1, "the RPC URL must use https");
  const passphrase = await client.passphrase();
  if (passphrase !== Networks.TESTNET) throw new PreconditionError(1, `the RPC reports a network that is not testnet ("${passphrase}")`);

  // 2. Signer: the agent wallet's public key is the deployment's publisher and the contract's publisher().
  const roles = await client.readRoles();
  if (deps.keypair === null && !opts.dryRun) throw new PreconditionError(2, "the agent has no wallet (AGENT_SECRET_KEY or the wallet file); cannot sign");
  const publisherKey = deps.keypair ? deps.keypair.publicKey() : deployment.publisher;
  if (publisherKey !== deployment.publisher) throw new PreconditionError(2, `the wallet's public key ${publisherKey} is not deployment.publisher ${deployment.publisher}`);
  if (roles.publisher !== publisherKey) throw new PreconditionError(2, `the contract's publisher() is ${roles.publisher}, not ${publisherKey}`);
  if (deps.keypair === null) out(`No wallet loaded; the dry run uses the publisher from deployment.json (${publisherKey}).`);
  else out(`Publisher ${publisherKey}${opts.dryRun ? " (dry run: not signing)" : ""}`);

  // 3. The status file is tracked and unmodified in git.
  if (!STATUS_FILE_NAME.test(opts.statusPath)) throw new PreconditionError(3, `${opts.statusPath} is not a data/status/YYYY-MM-DD.json file`);
  if (!git.isTracked(opts.statusPath)) throw new PreconditionError(3, `${opts.statusPath} is not tracked in git; commit it first`);
  if (git.isModified(opts.statusPath)) throw new PreconditionError(3, `${opts.statusPath} has uncommitted changes; commit or restore it first`);
  const commit = git.head();
  const text = deps.readFile(opts.statusPath);
  let file: StatusFile;
  try {
    file = parseStatusFile(JSON.parse(text));
  } catch (err) {
    throw new PreconditionError(3, err instanceof Error ? err.message : String(err));
  }

  // 4. The file's schema is the contract's schema.
  if (file.feed_schema !== roles.schema || file.feed_schema !== FEED_SCHEMA) {
    throw new PreconditionError(4, `the file has feed_schema ${file.feed_schema}, the contract has schema() ${roles.schema}, this code builds schema ${FEED_SCHEMA}`);
  }

  // 5. Every hash and key recomputes from the file. Assets with status null are checked but never sent.
  const fields = fileFieldsOf(file);
  const updates: { code: string; asset: string; update: Update }[] = [];
  const unpublished: string[] = [];
  const seen = new Set<string>();
  for (const a of file.assets) {
    try {
      if (seen.has(a.sac_contract_id)) throw new Error(`${a.asset}: sac_contract_id ${a.sac_contract_id} appears twice in the file`);
      seen.add(a.sac_contract_id);
      if (a.status === null) {
        checkIntegrity(fields, a);
        unpublished.push(a.asset);
      } else {
        updates.push({ code: a.asset.split(":")[0], asset: a.asset, update: toUpdate(fields, a) });
      }
    } catch (err) {
      throw new PreconditionError(5, err instanceof Error ? err.message : String(err));
    }
  }

  // 6. Current entries decide: same as_of and hash is a skip, an older as_of refuses the whole run.
  const entries = await client.readEntries(updates.map((u) => u.update.asset));
  const toSend: typeof updates = [];
  const skipped: string[] = [];
  const stale: typeof updates = [];
  const problems: string[] = [];
  updates.forEach((u, i) => {
    const e = entries[i];
    if (!e) return void toSend.push(u);
    if (u.update.as_of < e.as_of) {
      stale.push(u);
      problems.push(`${u.code}: as_of ${u.update.as_of} is older than the feed's ${e.as_of} (StaleAsOf)`);
    } else if (u.update.as_of === e.as_of && u.update.evidence_hash === e.evidence_hash) {
      skipped.push(u.asset);
    } else if (u.update.issuer_change_seen_at < e.issuer_change_seen_at) {
      problems.push(`${u.code}: issuer_change_seen_at ${u.update.issuer_change_seen_at} is earlier than the feed's ${e.issuer_change_seen_at} (ChangeTimeWentBack)`);
    } else {
      toSend.push(u);
    }
  });
  if (problems.length > 0) {
    if (opts.dryRun && stale.length > 0) {
      // Show what the contract itself says about the stale entry; informational, the run is refused either way.
      try {
        await client.simulatePublish([stale[0].update], publisherKey);
      } catch (err) {
        if (err instanceof FeedError) out(`Contract simulation of ${stale[0].code}: ${err.message}`);
      }
    }
    throw new PreconditionError(6, `refusing the whole run (stale or out-of-order file). ${problems.join("; ")}`);
  }

  out(`${file.assets.length} assets in ${opts.statusPath}: ${toSend.length} to publish, ${skipped.length} already published, ${unpublished.length} unpublished (status null)`);
  const summary: PublishSummary = {
    dryRun: opts.dryRun, published: [], skipped, unpublished, txHashes: [], failure: null, verify: null, ok: true,
  };

  // 7. Batches of at most batchSize, one at a time. Stop at the first real failure.
  const batches = chunk(toSend, opts.batchSize);
  if (!opts.dryRun && batches.length > 0) {
    const balance = await client.balanceStroops(publisherKey);
    if (balance < MIN_BALANCE_STROOPS) throw new PreconditionError(7, `the publisher has ${balance} stroops; fund it with Friendbot first`);
  }
  for (const [n, batch] of batches.entries()) {
    const label = `batch ${n + 1}/${batches.length} (${batch.length} entries)`;
    try {
      if (opts.dryRun) {
        const sim = await client.simulatePublish(batch.map((b) => b.update), publisherKey);
        out(`${label}: simulation OK, ${sim.written} written, min resource fee ${sim.minResourceFee}`);
        summary.published.push(...batch.map((b) => b.asset));
      } else {
        const res = await client.publishBatch(batch.map((b) => b.update), deps.keypair as Keypair);
        out(`${label}: tx ${res.txHash} in ledger ${res.ledger}`);
        summary.published.push(...batch.map((b) => b.asset));
        summary.txHashes.push(res.txHash);
        // 8. Log each transaction as soon as it is confirmed, so a later failure never loses it.
        deps.appendLog({
          at: deps.now().toISOString(), network: "testnet", contract_id: deployment.contract_id, tx_hash: res.txHash, ledger: res.ledger,
          status_file: opts.statusPath, status_sha256: sha256Hex(text), commit,
          assets: batch.map((b) => ({
            asset: b.asset, sac_contract_id: b.update.asset, status: b.update.status, flags: b.update.flags,
            evidence_hash: b.update.evidence_hash, as_of: Number(b.update.as_of),
          })),
        });
      }
    } catch (err) {
      if (!(err instanceof FeedError)) throw err;
      summary.failure = err;
      summary.ok = false;
      out(`${label}: FAILED ${err.message}${err.txHash ? ` (tx ${err.txHash})` : ""}`);
      if (!opts.dryRun) {
        out(`Stopped. Sent so far: ${summary.published.length} entries in ${summary.txHashes.length} transactions.`);
        return summary;
      }
    }
  }

  // 8 (cont.). Verify the whole file against the feed.
  if (summary.failure === null && (!opts.dryRun || toSend.length === 0)) {
    summary.verify = await verifyFile(file, client);
    out(formatVerifyTable(summary.verify));
    if (summary.verify.some((r) => !r.ok)) summary.ok = false;
  }
  return summary;
}
