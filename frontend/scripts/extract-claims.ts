/**
 * Extract claims from snapshotted issuer documents with the LLM, then keep
 * only the ones deterministic code can verify (golden rules 1 and 2).
 * SEC filings are not sent to the LLM; they are parsed by code (W2.3).
 *
 *   npm run extract:claims -- [--dry-run] [--reverify] [--asset CODE] [--limit N] [--force]
 *
 * --dry-run   show what would be sent (chunks, characters, estimated tokens); no LLM call
 * --reverify  re-run the verifier on the stored proposals; no LLM call
 * --force     ignore earlier runs (including failed ones) for the same config
 *
 * Batch extraction shares the app's daily token budget; it stops while
 * LLM_APP_RESERVE_TOKENS (default 50,000) would still be left for chat.
 */
import { createHash } from "node:crypto";
import { EXTRACT_MODEL as MODEL, budgetLeft, generateStructured } from "../agent/llm";
import { loadUniverse } from "../lib/chain/universe";
import { SnapshotStore, type SnapshotRecord } from "../lib/documents/store";
import { positiveInt } from "../lib/env";
import { buildClaims } from "../lib/claims/claim";
import { createContextFactory } from "../lib/claims/context";
import { CLAIM_FIELDS, extractionSchema, type ProposedClaim } from "../lib/claims/fields";
import { EXTRACTION_INSTRUCTIONS, PROMPT_VERSION, buildPrompt } from "../lib/claims/prompt";
import { MAX_CHARS_PER_DOCUMENT, selectChunks } from "../lib/claims/select";
import { ClaimStore, docKey, type ExtractionRun } from "../lib/claims/store";
import { verifyClaim, type AssetRef, type VerifyContext } from "../lib/claims/verify";

const MIN_HTML_CHARS = 1500;
const OUTPUT_TOKENS = 4096;
const APP_RESERVE = positiveInt("LLM_APP_RESERVE_TOKENS", 50_000);

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};

/** Everything that changes what the LLM sees, so a changed config never reuses an old run. */
function configKey(doc: string, assets: AssetRef[]) {
  const config = JSON.stringify([PROMPT_VERSION, EXTRACTION_INSTRUCTIONS, Object.keys(CLAIM_FIELDS), MAX_CHARS_PER_DOCUMENT, MODEL, doc, assets]);
  return createHash("sha256").update(config).digest("hex").slice(0, 32);
}

async function main() {
  const dryRun = flag("--dry-run");
  const reverify = flag("--reverify");
  const force = flag("--force");
  const onlyAsset = option("--asset");
  const limit = Number(option("--limit") ?? Infinity);

  const universe = loadUniverse();
  const snapshots = new SnapshotStore();
  const store = new ClaimStore();
  const now = new Date().toISOString();

  const { contextFor, officialDomainsOf } = createContextFactory(universe, snapshots);

  function save(record: SnapshotRecord, run: ExtractionRun, ctx: VerifyContext) {
    const { claims, dropped } = buildClaims({
      record, docKey: run.doc_key, officialDomains: officialDomainsOf(record), proposals: run.proposals,
      verify: (claim) => verifyClaim(claim, ctx), model: run.model, promptVersion: run.prompt_version, now: run.at, fieldSource: "llm",
    });
    store.record({ ...run, verified: claims.length, dropped: dropped.length }, claims, dropped);
    return { claims, dropped };
  }

  if (reverify) {
    let count = 0;
    for (const run of [...store.runs]) {
      const record = snapshots.all().find((r) => docKey(r.sha256, r.assets) === run.doc_key);
      const prepared = record && contextFor(record);
      if (!record || !prepared) {
        console.log(`skip (snapshot or text missing) ${run.source_url}`);
        continue;
      }
      const { claims, dropped } = save(record, run, prepared.ctx);
      count += claims.length;
      console.log(`${run.source_url}\n    ${run.proposals.length} proposals → ${claims.length} verified, ${dropped.length} dropped`);
    }
    store.flush();
    console.log(`\nRe-verified without the LLM: ${count} verified claims.`);
    return;
  }

  const seen = new Set<string>();
  const candidates = snapshots
    .all()
    .filter((r) => r.sourceClass === "issuer" || r.sourceClass === "issuer_toml")
    .filter((r) => r.text && (r.text.kind !== "html" || r.text.chars >= MIN_HTML_CHARS))
    .filter((r) => !onlyAsset || r.assets.some((a) => a.startsWith(`${onlyAsset}:`)))
    .filter((r) => {
      const key = docKey(r.sha256, r.assets);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  let done = 0;
  for (const record of candidates) {
    if (done >= limit) break;
    const prepared = contextFor(record);
    if (!prepared) {
      console.log(`skip (stored text does not match its hash or extractor; re-run snapshot:docs) ${record.url}`);
      continue;
    }
    const { ctx, text } = prepared;
    const doc = docKey(record.sha256, record.assets);
    const key = configKey(doc, ctx.assets);
    if (!force && store.hasRun(key)) continue;

    const extraTerms = ctx.assets.flatMap((a) => [a.code, a.name ?? ""]);
    const selection = selectChunks(text, record.text!.kind, extraTerms);
    const estimate = Math.ceil((selection.chars + EXTRACTION_INSTRUCTIONS.length) / 3.5) + OUTPUT_TOKENS;
    console.log(`${record.url}\n    ${record.text!.kind}, ${selection.chunks.length}/${selection.totalChunks} chunks, ${selection.chars} chars, ~${estimate} tokens max`);
    if (dryRun) continue;
    done++;

    const run: ExtractionRun = {
      key, doc_key: doc, snapshot_sha256: record.sha256, text_sha256: record.text!.sha256, source_url: record.url,
      chunks_sent: selection.chunks.length, chars_sent: selection.chars, proposals: [], verified: 0, dropped: 0, tokens: 0, error: null,
      model: MODEL, prompt_version: PROMPT_VERSION, at: now,
    };
    if (selection.chunks.length > 0) {
      if (budgetLeft() - APP_RESERVE < estimate) {
        console.log(`    stopping: ${budgetLeft()} tokens left today and ${APP_RESERVE} are kept for the app; this document may need ${estimate}`);
        break;
      }
      try {
        const result = await generateStructured({
          instructions: EXTRACTION_INSTRUCTIONS,
          prompt: buildPrompt({ url: record.url, kind: record.text!.kind, assets: ctx.assets, chunks: selection.chunks }),
          schema: extractionSchema(ctx.assets.map((a) => a.code) as [string, ...string[]]),
          maxOutputTokens: OUTPUT_TOKENS,
        });
        run.proposals = result.output.claims as ProposedClaim[];
        run.tokens = result.tokens;
      } catch (err) {
        run.error = err instanceof Error ? err.message.slice(0, 200) : String(err);
        run.tokens = null;
        console.log(`    LLM error (${run.error}); recorded, not retried without --force`);
      }
    }
    const { claims, dropped } = save(record, run, ctx);
    store.flush();
    const reasons = [...new Set(dropped.map((d) => d.reason))].join(", ");
    console.log(`    ${run.proposals.length} proposed, ${claims.length} verified, ${dropped.length} dropped${reasons ? ` (${reasons})` : ""}, ${run.tokens ?? "?"} tokens`);
  }

  if (!dryRun) {
    const byField = new Map<string, number>();
    for (const c of store.claims) byField.set(c.field, (byField.get(c.field) ?? 0) + 1);
    const assetsWithClaims = new Set(store.claims.flatMap((c) => (c.asset.startsWith("ISSUER:") ? [] : [c.asset])));
    console.log(`\n${store.claims.length} verified claims stored (${[...byField].map(([f, n]) => `${f} ${n}`).join(", ")}).`);
    console.log(`${assetsWithClaims.size}/${universe.length} assets have at least one verified asset-level claim. ${budgetLeft()} LLM tokens left today.`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
