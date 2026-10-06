/**
 * Extract claims from snapshotted issuer documents with the LLM, then keep
 * only the ones deterministic code can verify (golden rules 1 and 2).
 * SEC filings are not sent to the LLM; they are parsed by code (W2.3).
 *
 *   npm run extract:claims -- [--dry-run] [--asset CODE] [--limit N] [--force]
 *
 * --dry-run  show what would be sent (chunks, characters, estimated tokens); no LLM call
 * --force    ignore the cache of earlier runs for the same snapshot, prompt, and model
 */
import { createHash } from "node:crypto";
import { EXTRACT_MODEL as MODEL, budgetLeft, generateStructured } from "../agent/llm";
import { findCurrency, parseStellarToml } from "../lib/chain/toml";
import { loadUniverse } from "../lib/chain/universe";
import { EXTRACTOR_VERSION } from "../lib/documents/extract";
import { SnapshotStore, sha256Hex, type SnapshotRecord } from "../lib/documents/store";
import { MAX_CLAIMS_PER_DOCUMENT, extractionSchema, type ProposedClaim } from "../lib/claims/fields";
import { EXTRACTION_INSTRUCTIONS, PROMPT_VERSION, buildPrompt } from "../lib/claims/prompt";
import { selectChunks } from "../lib/claims/select";
import { ClaimStore, runKey, type Claim, type DroppedClaim } from "../lib/claims/store";
import { normalizeForMatch, verifyClaim, type AssetRef } from "../lib/claims/verify";

const MIN_HTML_CHARS = 1500;
const OUTPUT_TOKENS = 4096;

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};

async function main() {
  const dryRun = flag("--dry-run");
  const force = flag("--force");
  const onlyAsset = option("--asset");
  const limit = Number(option("--limit") ?? Infinity);

  const universe = loadUniverse();
  const snapshots = new SnapshotStore();
  const claims = new ClaimStore();
  const now = new Date().toISOString();

  // Asset names from the issuers' own tomls help attribute claims in multi-asset documents.
  const names = new Map<string, string>();
  for (const r of snapshots.all().filter((s) => s.sourceClass === "issuer_toml")) {
    const text = snapshots.readText(r.sha256);
    if (!text) continue;
    const { toml } = parseStellarToml(text);
    for (const key of r.assets) {
      const [code, issuer] = key.split(":");
      const name = findCurrency(toml, issuer, code)?.name;
      if (typeof name === "string") names.set(key, name);
    }
  }

  const candidates = snapshots
    .all()
    .filter((r) => r.sourceClass === "issuer" || r.sourceClass === "issuer_toml")
    .filter((r) => r.text && (r.text.kind !== "html" || r.text.chars >= MIN_HTML_CHARS))
    .filter((r) => !onlyAsset || r.assets.some((a) => a.startsWith(`${onlyAsset}:`)));

  let done = 0;
  for (const record of candidates) {
    if (done >= limit) break;
    const key = runKey({ snapshotSha256: record.sha256, textSha256: record.text!.sha256, promptVersion: PROMPT_VERSION, model: MODEL });
    if (!force && claims.hasRun(key)) continue;

    const text = snapshots.readText(record.sha256);
    if (!text || sha256Hex(text) !== record.text!.sha256 || record.text!.extractor !== EXTRACTOR_VERSION) {
      console.log(`skip (stored text does not match its hash or extractor; re-run snapshot:docs) ${record.url}`);
      continue;
    }
    const assets: AssetRef[] = record.assets.map((k) => ({ code: k.split(":")[0], name: names.get(k) }));
    const extraTerms = assets.flatMap((a) => [a.code, a.name ?? ""]);
    const selection = selectChunks(text, record.text!.kind, extraTerms);
    const estimate = Math.ceil((selection.chars + EXTRACTION_INSTRUCTIONS.length) / 3.5) + OUTPUT_TOKENS;
    console.log(`${record.url}\n    ${record.text!.kind}, ${selection.chunks.length}/${selection.totalChunks} chunks, ${selection.chars} chars, ~${estimate} tokens max`);
    if (dryRun) continue;
    done++;

    let proposed: ProposedClaim[] = [];
    let tokens: number | null = 0;
    if (selection.chunks.length > 0) {
      if (budgetLeft() < estimate) {
        console.log(`    stopping: ${budgetLeft()} tokens left today, this document may need ${estimate}`);
        break;
      }
      const codes = assets.map((a) => a.code) as [string, ...string[]];
      try {
        const result = await generateStructured({
          instructions: EXTRACTION_INSTRUCTIONS,
          prompt: buildPrompt({ url: record.url, kind: record.text!.kind, assets, chunks: selection.chunks }),
          schema: extractionSchema(codes),
          maxOutputTokens: OUTPUT_TOKENS,
        });
        proposed = result.output.claims.slice(0, MAX_CLAIMS_PER_DOCUMENT);
        tokens = result.tokens;
      } catch (err) {
        console.log(`    LLM error (${err instanceof Error ? err.message.slice(0, 160) : err}); will retry next run`);
        continue;
      }
    }

    const verified: Claim[] = [];
    const dropped: DroppedClaim[] = [];
    const normalized = normalizeForMatch(text);
    for (const claim of proposed) {
      const check = verifyClaim({ claim, text, normalized, isPdf: record.text!.kind === "pdf", assets });
      if (!check.ok) {
        dropped.push({
          snapshot_sha256: record.sha256, source_url: record.url, reason: check.reason, field: claim.field, asset_code: claim.asset_code,
          value_text: claim.value_text, quote: claim.quote, model: MODEL, prompt_version: PROMPT_VERSION, extracted_at: now,
        });
        continue;
      }
      verified.push(toClaim(record, claim, check.result, assets, now));
    }
    claims.record(
      {
        key, snapshot_sha256: record.sha256, source_url: record.url, chunks_sent: selection.chunks.length, chars_sent: selection.chars,
        proposed: proposed.length, verified: verified.length, dropped: dropped.length, tokens, model: MODEL, prompt_version: PROMPT_VERSION, at: now,
      },
      verified,
      dropped,
    );
    claims.flush();
    const reasons = [...new Set(dropped.map((d) => d.reason))].join(", ");
    console.log(`    ${proposed.length} proposed, ${verified.length} verified, ${dropped.length} dropped${reasons ? ` (${reasons})` : ""}, ${tokens ?? "?"} tokens`);
  }

  if (!dryRun) {
    const byField = new Map<string, number>();
    for (const c of claims.claims) byField.set(c.field, (byField.get(c.field) ?? 0) + 1);
    const assetsWithClaims = new Set(claims.claims.flatMap((c) => (c.asset.startsWith("ISSUER:") ? [] : [c.asset])));
    console.log(`\n${claims.claims.length} verified claims stored (${[...byField].map(([f, n]) => `${f} ${n}`).join(", ")}).`);
    console.log(`${assetsWithClaims.size}/${universe.length} assets have at least one verified asset-level claim. ${budgetLeft()} LLM tokens left today.`);
  }
}

function toClaim(record: SnapshotRecord, claim: ProposedClaim, result: { value: number | string; as_of: string | null; page: number | null }, assets: AssetRef[], now: string): Claim {
  const single = assets.length === 1 ? record.assets[0] : null;
  const asset =
    claim.asset_code === "ISSUER"
      ? `ISSUER:${new URL(record.finalUrl).hostname.replace(/^www\./, "")}`
      : single ?? record.assets.find((k) => k.startsWith(`${claim.asset_code}:`))!;
  const id = createHash("sha256").update([record.sha256, asset, claim.field, claim.quote, String(result.value)].join("|")).digest("hex").slice(0, 16);
  return {
    id, asset, field: claim.field, value: result.value, value_text: claim.value_text, unit: claim.unit, as_of: result.as_of, quote: claim.quote,
    source_url: record.url, source_class: record.sourceClass, page: result.page, snapshot_sha256: record.sha256, text_sha256: record.text!.sha256,
    extractor: record.text!.extractor, model: MODEL, prompt_version: PROMPT_VERSION, verified: true, extracted_at: now,
  };
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
