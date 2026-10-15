/**
 * Pause new borrows on the mock lending market where its own policy says so (spec 4.3).
 *
 *   npm run keeper:run -- --market live|demo [--dry-run] [--send-all]
 *
 * Simulates `check` for each listed asset and sends the permissionless `sync` only where a pause is due.
 * Signs through stellar-cli (`stellar tx sign --sign-with-key lending-keeper`); no secret enters Node.
 * No .env is loaded; the only settings read are FEED_RPC_URL and FEED_RPC_ALLOW_HOSTS. Testnet only.
 * Exit codes: 0 done, 1 refused (nothing signed), 2 a transaction outcome unknown, 3 a transaction failed.
 */
import { runKeeper } from "../lib/keeper/run";
import type { MarketName } from "../lib/keeper/records";
import { createDemoDeps } from "../lib/keeper/wire";

const USAGE = `Usage: npm run keeper:run -- --market live|demo [--dry-run] [--send-all]
  --market      the market to check (required)
  --dry-run     simulate only; sign and send nothing
  --send-all    send sync for every asset, not only where a pause is due (live evidence of the on-chain read)`;

function parseArgs(argv: readonly string[]) {
  let market: MarketName | null = null;
  let dryRun = false;
  let sendAll = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--market") {
      const v = argv[++i];
      if (v !== "live" && v !== "demo") throw new Error("--market must be live or demo");
      market = v;
    } else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--send-all") sendAll = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!market) throw new Error("--market is required");
  return { market, dryRun, sendAll };
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`${err instanceof Error ? err.message : String(err)}\n\n${USAGE}`);
    process.exit(1);
  }
  const result = await runKeeper(opts, createDemoDeps(opts.market));
  process.exit(result.exitCode);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
