/**
 * The Monitor (D-047): read Stellar mainnet through Horizon, note issuer events and daily mint and burn
 * sums, and re-run the deterministic pipeline (check:assets, examine, status) when the plan says so.
 * It never publishes, never runs git, never calls an LLM, and takes no environment file.
 *
 *   npm run monitor                          watch, then re-check if due
 *   npm run monitor -- --dry-run             read Horizon, print the plan, write nothing, run nothing
 *   npm run monitor -- --no-recheck          watch and save state only
 *   npm run monitor -- --recheck-now         add a forced reason (still obeys the frozen, budget and midnight rules)
 *   npm run monitor -- --replay-from YYYY-MM-DD [--issuer G...]   read that history, print events and sums (read only)
 *   npm run monitor -- --lookback-hours N    read the last N hours (1 to 48), exit 5 when an event is found (read only)
 *
 * Exit codes: 0 done, 1 refused, 2 partial (budget or an error ended a watch; state saved), 3 a pipeline step failed, 5 events found (--lookback-hours).
 */
import path from "path";
import { monitorLimits } from "../lib/monitor/cadence";
import { createHorizonClient } from "../lib/monitor/horizon";
import { nodeExec } from "../lib/monitor/pipeline";
import { runMonitor, type MonitorFlags } from "../lib/monitor/run";

const USAGE = "usage: npm run monitor -- [--dry-run] [--no-recheck] [--recheck-now] [--replay-from YYYY-MM-DD [--issuer G...]...] [--lookback-hours N]";

export function parseArgs(argv: readonly string[]): MonitorFlags {
  const flags: MonitorFlags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (!v || v.startsWith("--")) throw new Error(`${a} needs a value\n${USAGE}`);
      return v;
    };
    if (a === "--dry-run") flags.dryRun = true;
    else if (a === "--no-recheck") flags.noRecheck = true;
    else if (a === "--recheck-now") flags.forced = true;
    else if (a === "--replay-from") flags.replayFrom = value();
    else if (a === "--issuer") flags.replayIssuers = [...(flags.replayIssuers ?? []), value()];
    else if (a === "--lookback-hours") {
      const n = Number(value());
      if (!Number.isInteger(n) || n < 1 || n > 48) throw new Error(`--lookback-hours must be a whole number from 1 to 48\n${USAGE}`);
      flags.lookbackHours = n;
    } else throw new Error(`unknown argument ${a}\n${USAGE}`);
  }
  if (flags.replayIssuers && flags.replayFrom === undefined) throw new Error(`--issuer needs --replay-from\n${USAGE}`);
  if (flags.replayFrom !== undefined && flags.lookbackHours !== undefined) throw new Error(`use --replay-from or --lookback-hours, not both\n${USAGE}`);
  return flags;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const limits = monitorLimits();
  const result = await runMonitor(
    { now: new Date(), dataDir: path.join(process.cwd(), "..", "data"), flags, limits },
    { horizon: createHorizonClient({ maxRequests: limits.maxRequests }), exec: nodeExec, log: (line) => console.log(line), frontendDir: process.cwd() },
  );
  process.exit(result.exitCode);
}

// Only run when started as a script (the tests import parseArgs).
if (process.argv[1] && path.basename(process.argv[1]).startsWith("monitor.")) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
