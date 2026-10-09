/**
 * Compare what the feed contract holds with a status file (spec 3.4, steps 1 to 3).
 *
 *   npm run feed:verify -- --status data/status/YYYY-MM-DD.json
 *
 * Read only (simulation); needs no key. Exits 1 on any mismatch.
 */
import fs from "fs";
import path from "path";
import { Networks } from "@stellar/stellar-sdk";
import { createFeedClient, createRpc, feedRpcUrl } from "../lib/feed/client";
import { loadDeployment } from "../lib/feed/deployment";
import { parseStatusFile } from "../lib/feed/encode";
import { formatVerifyTable, verifyFile } from "../lib/feed/verify";

const REPO_ROOT = path.join(process.cwd(), "..");
const USAGE = "Usage: npm run feed:verify -- --status data/status/YYYY-MM-DD.json";

async function main() {
  const argv = process.argv.slice(2);
  const given = argv.length === 2 && argv[0] === "--status" ? argv[1] : undefined;
  if (!given) {
    console.error(USAGE);
    process.exit(2);
  }
  const file = parseStatusFile(JSON.parse(fs.readFileSync(path.resolve(REPO_ROOT, given), "utf8")));
  const deployment = loadDeployment();
  const client = createFeedClient({ rpc: createRpc(feedRpcUrl()), contractId: deployment.contract_id });
  const passphrase = await client.passphrase();
  if (passphrase !== Networks.TESTNET) throw new Error(`The RPC reports a network that is not testnet ("${passphrase}")`);
  const rows = await verifyFile(file, client);
  console.log(formatVerifyTable(rows));
  if (rows.some((r) => !r.ok)) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
