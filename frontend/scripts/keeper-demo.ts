/**
 * The scripted CRITICAL-path demo on the demo market and the separate demo feed (spec 4.5).
 *
 *   npm run keeper:demo -- [--dry-run] [--from-step N]
 *   npm run keeper:demo -- --print-key
 *
 * The demo feed holds one synthetic testnet key, SYNTH; its entries are test data, not a Recon finding.
 * The code refuses any `publish` to Recon's feed. Signs through stellar-cli; no secret enters Node.
 * No .env is loaded. Testnet only. Exit codes as `keeper:run`.
 */
import { publicKeyOf } from "../lib/keeper/cli-signer";
import { runDemo } from "../lib/keeper/demo";
import { IDENTITIES, SYNTH_CODE, syntheticKey } from "../lib/keeper/records";
import { createDemoDeps } from "../lib/keeper/wire";

const USAGE = `Usage: npm run keeper:demo -- [--dry-run] [--from-step N]
       npm run keeper:demo -- --print-key
  --dry-run     run the guards and simulate through step 1; sign and send nothing
  --from-step   resume at step N (0 to 12) after a failure
  --print-key   print the synthetic key of the demo writer and exit (needs no records)`;

function parseArgs(argv: readonly string[]) {
  let dryRun = false;
  let fromStep = 0;
  let printKey = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--print-key") printKey = true;
    else if (arg === "--from-step") {
      const v = argv[++i];
      if (!v || !/^\d+$/.test(v) || Number(v) > 12) throw new Error("--from-step must be a whole number from 0 to 12");
      fromStep = Number(v);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return { dryRun, fromStep, printKey };
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`${err instanceof Error ? err.message : String(err)}\n\n${USAGE}`);
    process.exit(1);
  }
  if (opts.printKey) {
    console.log(syntheticKey(SYNTH_CODE, publicKeyOf(IDENTITIES.writer)));
    return;
  }
  const result = await runDemo(opts, createDemoDeps("demo"));
  process.exit(result.exitCode);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
