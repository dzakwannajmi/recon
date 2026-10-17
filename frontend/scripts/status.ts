/**
 * Status v1: decide every flag for every pinned asset from the stored run
 * files and write the status that the feed will publish. Deterministic:
 * no network, no LLM, no env file.
 *
 *   npm run status [-- --as-of YYYY-MM-DD] [--out <file outside data/>]
 *
 * Writes data/status/YYYY-MM-DD.json (atomically), or the --out file for a dry recompute.
 * A status file that a published status used is never overwritten (D-047).
 */
import fs from "fs";
import path from "path";
import { parseAsOf } from "../lib/flags/inputs";
import { buildStatus, resolveOut } from "../lib/flags/run";
import { assertWritable } from "../lib/monitor/frozen";

const DATA = path.join(process.cwd(), "..", "data");

function writeJson(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

function main() {
  const argv = process.argv.slice(2);
  const asOf = parseAsOf(argv);
  const out = resolveOut(argv, DATA);
  const rel = `data/status/${asOf}.json`;
  if (!out) assertWritable(rel, DATA);

  const status = buildStatus({ dataDir: DATA, asOf, now: new Date() });

  if (!out) assertWritable(rel, DATA);
  writeJson(out ?? path.join(DATA, "status", `${asOf}.json`), status);

  for (const a of status.assets) {
    const flags = a.raised.map((r) => `${r.flag}${r.review === "pending" ? " (pending review)" : ""}`).join(", ");
    console.log(`${a.asset_code.padEnd(8)} ${(a.status ?? "unpublished").padEnd(11)} ${flags || "-"}`);
  }
  const s = status.summary;
  console.log(`\nas of ${asOf}: ${s.OK} OK, ${s.WARNING} WARNING, ${s.CRITICAL} CRITICAL, ${s.unpublished} unpublished, ${s.pending_review} pending review`);
  console.log(`wrote ${out ?? rel}`);
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
