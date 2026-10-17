/**
 * Demo of the Monitor with simulated events (spec 5.2). It copies the files a run reads into a temporary
 * folder, serves one made-up issuer `set_options` and one made-up large mint from a fake Horizon, and
 * prints the three pipeline commands instead of running them. Every line starts with SIMULATED.
 * It never touches data/, the network, or a process.
 *
 *   npm run monitor:demo
 */
import fs from "fs";
import os from "os";
import path from "path";
import { monitorLimits } from "../lib/monitor/cadence";
import { copyDemoData, freshenChecks, recordingExec, syntheticHorizon } from "../lib/monitor/demo";
import { runMonitor, summarizeReasons } from "../lib/monitor/run";

const ETHERFUSE_ISSUER = "GCRYUGD5NVARGXT56XEZI5CIFCQETYHAPQQTHO2O3IQZTHDH4LATMYWC";

async function main() {
  const out = (line: string) => console.log(line.startsWith("SIMULATED") ? line : `SIMULATED ${line}`);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "monitor-demo-"));
  try {
    const realData = path.join(process.cwd(), "..", "data");
    const dataDir = copyDemoData(realData, root);
    const now = new Date();
    freshenChecks(dataDir, new Date(now.getTime() - 3_600_000)); // the copy only: its checks look one hour old
    const { horizon } = syntheticHorizon(dataDir, now, { setOptionsFor: ETHERFUSE_ISSUER, largeMintShare: { issuer: ETHERFUSE_ISSUER, percent: 30 } });
    out(`clock ${now.toISOString()}; a made-up issuer set_options and a made-up large mint on the Etherfuse issuer; the pipeline commands are printed, not run.`);
    const { exec } = recordingExec();
    const result = await runMonitor(
      { now, dataDir, flags: {}, limits: monitorLimits() },
      { horizon, exec, log: out, frontendDir: process.cwd(), synthetic: true },
    );
    out(`result: exit ${result.exitCode}; run outcome ${result.run?.outcome ?? "none"}; reasons ${result.run ? summarizeReasons(result.run.reasons) : "none"}`);
    out("data/ was not touched.");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
