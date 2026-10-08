/**
 * List the documents that need an operator review (automated extraction failed
 * or gave no verified claim) and write data/review/queue.json. No network, no
 * LLM, no env file. Document text is never printed.
 *
 *   npm run review:queue
 */
import { loadUniverse } from "../lib/chain/universe";
import { createContextFactory } from "../lib/claims/context";
import { ClaimStore } from "../lib/claims/store";
import { SnapshotStore } from "../lib/documents/store";
import { DEFAULT_REVIEW_DIR, currentQueue, loadProposals, printQueue, readImports, writeQueue, type ReviewEnv } from "../lib/review/files";

const snapshots = new SnapshotStore();
const env: ReviewEnv = {
  reviewDir: DEFAULT_REVIEW_DIR, store: new ClaimStore(), snapshots, factory: createContextFactory(loadUniverse(), snapshots), now: new Date().toISOString(),
};
const { loaded, warnings } = loadProposals(env);
const { entries, skipped } = currentQueue(env, loaded, readImports(env));
writeQueue(env, entries);
printQueue(entries, skipped, warnings);
const count = (status: string) => entries.filter((e) => e.status === status).length;
console.log(`\n${entries.length} in the queue (open ${count("open")}, proposed ${count("proposed")}, imported ${count("imported")}, stale ${count("stale")}, refused ${count("refused")}). Written to data/review/queue.json.`);
