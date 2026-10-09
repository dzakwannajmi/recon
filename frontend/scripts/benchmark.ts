/**
 * Extraction benchmark (W2.6): Gemini, Groq, and OpenRouter configs. Same documents, same extraction window,
 * same prompt and schema as `extract:claims`; the output never touches
 * data/claims/. Scoring is a separate step: `npm run benchmark:score`.
 *
 *   npm run benchmark -- --list-models
 *   npm run benchmark -- --windows
 *   npm run benchmark -- --config <name> [--doc <id>] [--limit N] [--gap SECONDS] [--force] [--dry-run]
 */
import path from "node:path";
import { PROVIDER, budgetLeft, generateStructured, hasApiKey } from "../agent/llm";
import { CONFIGS } from "../lib/benchmark/configs";
import { OUTPUT_TOKENS, prepareDocs, writeWindows } from "../lib/benchmark/docs";
import { flashModels, listModels } from "../lib/benchmark/models";
import { BENCH_DIR, readRuns, runBenchmark, writeRuns } from "../lib/benchmark/run";
import { loadUniverse } from "../lib/chain/universe";
import { createContextFactory } from "../lib/claims/context";
import { SnapshotStore } from "../lib/documents/store";
import { positiveInt } from "../lib/env";

const APP_RESERVE = positiveInt("LLM_APP_RESERVE_TOKENS", 50_000);
// Free-tier requests per minute differ per model (Flash is lower than Flash-Lite); --gap <seconds> widens the gap.
const DEFAULT_GAP_S = 6;
const RETRY_WAIT_MS = 30_000;

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};

function positiveSeconds(text: string) {
  const n = Number(text);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`--gap must be a positive number of seconds, got "${text}".`);
  return n;
}

async function main() {
  if (flag("--list-models")) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error("GEMINI_API_KEY is not set (put it in frontend/.env).");
    for (const m of flashModels(await listModels(key))) console.log(`${m.name.padEnd(40)} version ${m.version.padEnd(12)} ${m.displayName}`);
    return;
  }

  const snapshots = new SnapshotStore();
  const factory = createContextFactory(loadUniverse(), snapshots);
  const { docs, stale } = prepareDocs(snapshots, factory);
  for (const url of stale) console.log(`skip (stored text does not match its hash or extractor; re-run snapshot:docs) ${url}`);

  if (flag("--windows")) {
    const dir = path.join(process.cwd(), "..", "data", "snapshots", "text", "windows");
    writeWindows(dir, docs);
    for (const d of docs) console.log(`${d.id} ${String(d.window_chars).padStart(6)}/${String(d.full_chars).padStart(7)} chars  ${d.url}`);
    console.log(`\nWrote ${docs.length} window files and manifest.json to data/snapshots/text/windows/.`);
    return;
  }

  const name = option("--config");
  const config = CONFIGS.find((c) => c.name === name);
  if (!config) throw new Error(`Pass --config <${CONFIGS.map((c) => c.name).join("|")}>, --windows, or --list-models.`);
  const only = option("--doc");
  if (flag("--doc") && (!only || only.startsWith("--"))) throw new Error("--doc needs an id or prefix.");
  // --doc takes the full id or a unique prefix (the review queue shows 16 characters).
  const selected = only ? docs.filter((d) => d.id.startsWith(only)) : docs;
  if (only && selected.length !== 1) throw new Error(`${selected.length === 0 ? "No candidate document has" : "More than one candidate document starts with"} id ${only}.`);

  const file = path.join(BENCH_DIR, "runs", `${config.name}.json`);
  const dry = flag("--dry-run");
  if (!dry && !hasApiKey(config.provider)) throw new Error(`The API key for provider "${config.provider}" is not set (put it in frontend/.env). Nothing was run.`);
  const outputTokens = config.maxOutputTokens ?? OUTPUT_TOKENS;
  const summary = await runBenchmark({
    config, docs: selected, runs: readRuns(file), force: flag("--force"), limit: Number(option("--limit") ?? Infinity), dryRun: dry,
    // The chat reserve only applies to the chat provider's quota.
    budgetLeft: () => budgetLeft(config.provider), appReserve: config.provider === PROVIDER ? APP_RESERVE : 0,
    outputTokens, minGapMs: positiveSeconds(option("--gap") ?? String(DEFAULT_GAP_S)) * 1000, retryWaitMs: RETRY_WAIT_MS,
    generate: ({ instructions, prompt, schema }) =>
      generateStructured({ instructions, prompt, schema, maxOutputTokens: outputTokens, provider: config.provider, model: config.model, providerOptions: config.providerOptions, maxRetries: 0 }),
    save: (runs) => writeRuns(file, runs),
    log: (line) => console.log(line),
  });
  console.log(
    `\n${config.name} (${config.provider}/${config.model}): ${dry ? "dry run, " : ""}${summary.ran} run, ${summary.skipped} skipped (already done), ${summary.failed} failed` +
      `${summary.stoppedForBudget ? ", stopped for budget" : ""}. ` +
      `${dry ? `Estimated up to ~${summary.estimatedTokens} tokens (input estimate plus the ${outputTokens}-token output cap per call; thinking tokens count inside the cap). ` : ""}${budgetLeft(config.provider)} LLM tokens left today.`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
