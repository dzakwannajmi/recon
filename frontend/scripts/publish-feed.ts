/**
 * Publish a committed status file to the feed contract on testnet (spec 8.1).
 *
 *   npm run feed:publish -- --status data/status/YYYY-MM-DD.json [--dry-run] [--batch-size N]
 *
 * Reads data/feed/deployment.json and the status file; appends data/feed/log.json; then verifies.
 * The signing key comes only from agent/wallet.ts (AGENT_SECRET_KEY or the wallet file) and is never printed.
 * The status and flags are those lib/flags wrote into the file. No LLM is involved (golden rule 1).
 * Testnet only: every precondition failure exits 1 before anything is sent.
 */
import fs from "fs";
import path from "path";
import { getAgentKeypair } from "../agent/wallet";
import { createFeedClient, createRpc, feedRpcUrl } from "../lib/feed/client";
import { LOG_FILE, loadDeployment } from "../lib/feed/deployment";
import { MAX_BATCH } from "../lib/feed/encode";
import { PreconditionError, appendLogFile, readLogFile, runPublish, shellGit } from "../lib/feed/publish";

const REPO_ROOT = path.join(process.cwd(), "..");
const USAGE = `Usage: npm run feed:publish -- --status data/status/YYYY-MM-DD.json [--dry-run] [--batch-size N]
  --status       committed status file, relative to the repository root (required)
  --dry-run      simulate every batch; sign and send nothing
  --batch-size   entries per transaction, 1 to ${MAX_BATCH} (default ${MAX_BATCH})`;

function parseArgs(argv: readonly string[]) {
  let statusPath: string | null = null;
  let dryRun = false;
  let batchSize = MAX_BATCH;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--status") statusPath = argv[++i] ?? null;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--batch-size") {
      const v = argv[++i];
      if (!v || !/^\d+$/.test(v)) throw new Error("--batch-size must be a whole number");
      batchSize = Number(v);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!statusPath) throw new Error("--status is required");
  // A repo-relative posix path; the runner checks the name, and git checks that the file is tracked.
  const rel = path.relative(REPO_ROOT, path.resolve(REPO_ROOT, statusPath)).split(path.sep).join("/");
  return { statusPath: rel, dryRun, batchSize };
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`${err instanceof Error ? err.message : String(err)}\n\n${USAGE}`);
    process.exit(2);
  }
  const rpcUrl = feedRpcUrl();
  const deployment = loadDeployment();
  const client = createFeedClient({ rpc: createRpc(rpcUrl), contractId: deployment.contract_id });
  const summary = await runPublish(opts, {
    deployment,
    rpcUrl,
    client,
    keypair: getAgentKeypair(),
    git: shellGit(REPO_ROOT),
    readFile: (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8"),
    appendLog: (record) => appendLogFile(LOG_FILE, record),
    checkLog: () => void readLogFile(LOG_FILE),
    now: () => new Date(),
    out: (line) => console.log(line),
  });
  if (!summary.ok) process.exit(1);
}

main().catch((err) => {
  if (err instanceof PreconditionError) console.error(`Refused (precondition ${err.precondition}): ${err.message}`);
  else console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
