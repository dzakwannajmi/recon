/**
 * Score the benchmark runs against the gold set (no network, no LLM, no env
 * file). Reads data/gold/*.json and data/benchmark/runs/*.json, checks every
 * claim with the production verifier, and writes data/benchmark/scores.json
 * (deterministic) plus a markdown summary on stdout.
 *
 *   npm run benchmark:score
 */
import fs from "node:fs";
import path from "node:path";
import { loadUniverse } from "../lib/chain/universe";
import { CONFIGS } from "../lib/benchmark/configs";
import { prepareDocs, windowText } from "../lib/benchmark/docs";
import { BENCH_DIR, runKey, type RunRecord } from "../lib/benchmark/run";
import { assetCanon, goldFileSchema, renderMarkdown, score, type GoldFile, type ScoreDocEnv } from "../lib/benchmark/score";
import { buildClaims } from "../lib/claims/claim";
import { createContextFactory } from "../lib/claims/context";
import { PROMPT_VERSION } from "../lib/claims/prompt";
import { ClaimStore } from "../lib/claims/store";
import { verifyClaim } from "../lib/claims/verify";
import { SnapshotStore } from "../lib/documents/store";
import { writeJson } from "../lib/review/files";

const GOLD_DIR = process.env.GOLD_DIR || path.join(process.cwd(), "..", "data", "gold");
const RUNS_DIR = path.join(BENCH_DIR, "runs");
const FIXED_TIME = "1970-01-01T00:00:00.000Z";

const jsonFiles = (dir: string) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort() : []);

const snapshots = new SnapshotStore();
const factory = createContextFactory(loadUniverse(), snapshots);
const { docs } = prepareDocs(snapshots, factory);

const envs: ScoreDocEnv[] = docs.map((d) => ({
  id: d.id, doc_key: d.doc_key, url: d.url, text_sha256: d.text_sha256, window_chars: d.window_chars, full_chars: d.full_chars, window_text: windowText(d.chunks),
  canon: assetCanon(d.record.assets, factory.officialDomainsOf(d.record)),
  verify: (proposals, fieldSource) =>
    buildClaims({
      record: d.record, docKey: d.doc_key, officialDomains: factory.officialDomainsOf(d.record), proposals, verify: (claim) => verifyClaim(claim, d.ctx),
      model: "benchmark", promptVersion: PROMPT_VERSION, now: FIXED_TIME, fieldSource,
    }),
}));

const gold: GoldFile[] = jsonFiles(GOLD_DIR).map((f) => {
  const parsed = goldFileSchema.safeParse(JSON.parse(fs.readFileSync(path.join(GOLD_DIR, f), "utf8")));
  if (!parsed.success) throw new Error(`data/gold/${f} is not a valid gold file: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`);
  return parsed.data;
});

const runs: Record<string, RunRecord[]> = {};
for (const f of jsonFiles(RUNS_DIR)) runs[f.replace(/\.json$/, "")] = JSON.parse(fs.readFileSync(path.join(RUNS_DIR, f), "utf8")) as RunRecord[];

// A run counts only if it was made with the config and document as they are now.
const expectedKey = (config: string, docId: string) => {
  const c = CONFIGS.find((x) => x.name === config);
  const d = docs.find((x) => x.id === docId);
  return c && d ? runKey(c, d) : null;
};

const scores = score({ docs: envs, gold, runs, expectedKey, reviewedClaims: new ClaimStore().claims });
writeJson(path.join(BENCH_DIR, "scores.json"), scores);
console.log(renderMarkdown(scores));
console.log("\nWritten to data/benchmark/scores.json.");
