/**
 * Import the operator's proposals (data/review/proposals/*.json) through the
 * same quote verifier and claim builder as extract:claims. Accepted claims are
 * stored with field_source "operator-reviewed"; everything else is logged with
 * its reason in data/review/imports.json. No network, no LLM, no env file.
 *
 *   npm run import:review
 *
 * Exits with code 1 if any proposals file was refused.
 */
import { loadUniverse } from "../lib/chain/universe";
import { createContextFactory } from "../lib/claims/context";
import { ClaimStore } from "../lib/claims/store";
import { SnapshotStore } from "../lib/documents/store";
import { DEFAULT_REVIEW_DIR, printQueue, type ReviewEnv } from "../lib/review/files";
import { runImport } from "../lib/review/import";

const snapshots = new SnapshotStore();
const env: ReviewEnv = {
  reviewDir: DEFAULT_REVIEW_DIR, store: new ClaimStore(), snapshots, factory: createContextFactory(loadUniverse(), snapshots), now: new Date().toISOString(),
};
const { outcomes, entries, skipped, warnings, refused } = runImport(env);

if (outcomes.length === 0) console.log("No proposals files in data/review/proposals/; nothing to import.");
for (const o of outcomes) {
  const reasons = [...new Set(o.dropped.map((d) => d.reason))].join(", ");
  const detail = o.status === "imported" ? `${o.proposed} proposed, ${o.verified} verified, ${o.claim_ids.length} stored, ${o.skipped_duplicates.length} duplicates skipped, ${o.dropped.length} dropped${reasons ? ` (${reasons})` : ""}` : o.reason;
  console.log(`${o.id}  ${o.status}  ${detail}`);
}
console.log("");
printQueue(entries, skipped, warnings);
if (refused > 0) {
  console.error(`\n${refused} proposals file(s) refused; see data/review/imports.json.`);
  process.exitCode = 1;
}
