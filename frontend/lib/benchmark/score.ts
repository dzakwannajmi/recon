/**
 * Benchmark scorer (pure: no network, no LLM, no file access). It turns a
 * run's proposals and the gold items into claims through the same verifier
 * path (`env.verify`), matches them one to one, and counts true positives,
 * false positives, and false negatives. Gold items the verifier drops are
 * "verifier-blocked": listed, and left out of the recall denominator.
 */
import { z } from "zod";
import { FIELD_NAMES, type ProposedClaim } from "../claims/fields";
import type { Claim, ClaimFieldSource, DroppedClaim } from "../claims/store";
import { normalizeForMatch } from "../claims/verify";
import type { RunRecord } from "./run";

export const goldFileSchema = z.object({
  id: z.string(),
  doc_key: z.string(),
  source_url: z.string(),
  text_sha256: z.string(),
  window: z.object({ labels: z.array(z.string()), chars: z.number() }),
  labeled_by: z.string(),
  checked_by: z.string(),
  labeled_at: z.string(),
  note: z.string().optional(),
  items: z.array(
    z.object({
      field: z.enum(FIELD_NAMES),
      asset_code: z.string(),
      value_text: z.string(),
      unit: z.string().nullable(),
      as_of_text: z.string().nullable(),
      quote: z.string(),
      page: z.number().int().nullable(),
      origin: z.enum(["reader", "operator-reviewed", "adjudication"]),
      comment: z.string().optional(),
    }),
  ),
});
export type GoldFile = z.infer<typeof goldFileSchema>;
export type GoldItem = GoldFile["items"][number];

/** Everything the scorer needs to know about one document. */
export type ScoreDocEnv = {
  id: string;
  doc_key: string;
  url: string;
  text_sha256: string;
  window_chars: number;
  full_chars: number;
  /** The window as sent to the model. */
  window_text: string;
  /** Asset key and code equivalences for matching (see assetCanon). Identity if absent. */
  canon?: AssetCanon;
  /** buildClaims + verifyClaim with the production context. */
  verify: (proposals: ProposedClaim[], fieldSource: ClaimFieldSource) => { claims: Claim[]; dropped: DroppedClaim[] };
};

export type ScoreInput = {
  docs: ScoreDocEnv[];
  gold: GoldFile[];
  /** Run records per config name. */
  runs: Record<string, RunRecord[]>;
  /** The run key the current config and document would produce (`runKey`); a run with another key is stale. Null for an unknown config. */
  expectedKey: (config: string, docId: string) => string | null;
  /** Operator-reviewed claims from data/claims/claims.json, for the window check. */
  reviewedClaims: Claim[];
};

// ---------- matching ----------

/** Lowercase letters and digits only, so spacing, case, and punctuation do not matter. */
export const normalizeText = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/**
 * Value normalization for text comparison. For `networks` only, the generic
 * words blockchain, network, chain, and mainnet are dropped first (whole
 * words), so "Stellar Blockchain" equals "Stellar" and "Provenance Blockchain"
 * equals "Provenance". Applied to model and gold values alike. If nothing is
 * left after dropping them, the plain normalization is used.
 */
export function normalizeValue(s: string, field?: string) {
  if (field === "networks") {
    const stripped = normalizeText(s.replace(/\b(blockchain|network|chain|mainnet)\b/gi, " "));
    if (stripped) return stripped;
  }
  return normalizeText(s);
}

export function sameValue(a: number | string, b: number | string, field?: string) {
  if (typeof a === "number" || typeof b === "number") return a === b;
  return normalizeValue(a, field) === normalizeValue(b, field);
}

/**
 * Asset equivalences inside one document. In a document about exactly one
 * asset, an issuer-level claim (`ISSUER:<official domain>`, code `ISSUER`)
 * and that asset are the same subject. Multi-asset documents stay strict.
 */
export type AssetCanon = { key: (asset: string) => string; code: (assetCode: string) => string };

export function assetCanon(assets: string[], officialDomains: string[]): AssetCanon {
  const only = assets.length === 1 ? assets[0] : null;
  const domains = new Set(officialDomains);
  return {
    key: (asset) => (only && asset.startsWith("ISSUER:") && domains.has(asset.slice("ISSUER:".length)) ? only : asset),
    code: (assetCode) => (only && assetCode === "ISSUER" ? only.split(":")[0] : assetCode),
  };
}
const IDENTITY_CANON: AssetCanon = { key: (a) => a, code: (c) => c };
const codeOfKey = (asset: string) => (asset.startsWith("ISSUER:") ? "ISSUER" : asset.split(":")[0]);

/** Same asset, field, and value; the as-of date has to agree only when both claims have one. */
export function claimsMatch(a: Claim, b: Claim, canon: AssetCanon = IDENTITY_CANON) {
  return canon.key(a.asset) === canon.key(b.asset) && a.field === b.field && sameValue(a.value, b.value, a.field) && (a.as_of === null || b.as_of === null || a.as_of === b.as_of);
}

const claimOrder = (a: Claim, b: Claim) =>
  a.asset.localeCompare(b.asset) || a.field.localeCompare(b.field) || String(a.value).localeCompare(String(b.value)) || (a.as_of ?? "").localeCompare(b.as_of ?? "") || a.id.localeCompare(b.id);

/**
 * One-to-one matching of model claims to gold claims with the most pairs
 * (augmenting paths; a claim without an as-of date can fit several gold
 * claims, so a greedy pass could pair them badly). Deterministic.
 */
export function matchOneToOne(model: Claim[], gold: Claim[], canon: AssetCanon = IDENTITY_CANON) {
  const m = [...model].sort(claimOrder);
  const g = [...gold].sort(claimOrder);
  const goldOwner: (number | null)[] = g.map(() => null);
  const tryAssign = (i: number, seen: Set<number>): boolean => {
    for (let j = 0; j < g.length; j++) {
      if (seen.has(j) || !claimsMatch(m[i], g[j], canon)) continue;
      seen.add(j);
      if (goldOwner[j] === null || tryAssign(goldOwner[j]!, seen)) {
        goldOwner[j] = i;
        return true;
      }
    }
    return false;
  };
  for (let i = 0; i < m.length; i++) tryAssign(i, new Set());
  const matchedModel = new Set(goldOwner.filter((x): x is number => x !== null));
  return {
    tp: matchedModel.size,
    /** The matched model claims themselves (by position, so equal ids cannot confuse the count). */
    matched: m.filter((_, i) => matchedModel.has(i)),
    fp: m.filter((_, i) => !matchedModel.has(i)),
    fn: g.filter((_, j) => goldOwner[j] === null),
  };
}

// ---------- statistics ----------

const round = (x: number) => Math.round(x * 10_000) / 10_000;

export type Rate = { value: number | null; low: number | null; high: number | null; n: number };

/** Wilson score interval (95 %) for k successes out of n. */
export function wilson(k: number, n: number, z = 1.96): Rate {
  if (n <= 0) return { value: null, low: null, high: null, n: 0 };
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return { value: round(p), low: round(Math.max(0, center - half)), high: round(Math.min(1, center + half)), n };
}

export const f1 = (tp: number, fp: number, fn: number) => (2 * tp + fp + fn === 0 ? null : round((2 * tp) / (2 * tp + fp + fn)));

export function median(xs: number[]) {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Nearest-rank percentile, p in (0, 1]. */
export function percentile(xs: number[], p: number) {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil(p * s.length) - 1)];
}

// ---------- scoring ----------

type Counts = { tp: number; fp: number; fn: number };
type Item = { field: string; asset: string; value: number | string; value_text: string; as_of: string | null; quote: string };
const item = (c: Claim): Item => ({ field: c.field, asset: c.asset, value: c.value, value_text: c.value_text, as_of: c.as_of, quote: c.quote });
const addTo = (target: Record<string, number>, key: string) => (target[key] = (target[key] ?? 0) + 1);

export type DocScore = Counts & {
  doc_id: string;
  proposals: number;
  verified: number;
  dropped: Record<string, number>;
  by_field: Record<string, Counts>;
  fp_items: Item[];
  fn_items: Item[];
  /** Diagnostic only: false positives that equal a gold item the verifier blocked. */
  fp_matching_blocked: Item[];
};

const toProposal = (g: GoldItem): ProposedClaim => ({ field: g.field, asset_code: g.asset_code, value_text: g.value_text, unit: g.unit, as_of_text: g.as_of_text, quote: g.quote, page: g.page });

/**
 * Score one run against the document's gold claims (verified once by the
 * caller). `blockedGold` are the gold items the verifier dropped; a false
 * positive that matches one (same asset, field, and normalized value text)
 * is counted in `fp_matching_blocked` as a diagnostic only. It does not
 * change TP, FP, or FN.
 */
function scoreDoc(env: ScoreDocEnv, run: RunRecord, goldClaims: Claim[], blockedGold: DroppedClaim[]): DocScore {
  const canon = env.canon ?? IDENTITY_CANON;
  const { claims, dropped } = env.verify(run.proposals, "llm");
  const { tp, matched, fp, fn } = matchOneToOne(claims, goldClaims, canon);
  const droppedBy: Record<string, number> = {};
  for (const d of dropped) addTo(droppedBy, d.reason);
  const byField: Record<string, Counts> = {};
  const bump = (field: string, k: keyof Counts) => ((byField[field] ??= { tp: 0, fp: 0, fn: 0 })[k] += 1);
  for (const c of matched) bump(c.field, "tp");
  for (const c of fp) bump(c.field, "fp");
  for (const c of fn) bump(c.field, "fn");
  const fpBlocked = fp.filter((c) =>
    blockedGold.some((d) => d.field === c.field && canon.code(d.asset_code) === codeOfKey(canon.key(c.asset)) && normalizeValue(d.value_text, c.field) === normalizeValue(c.value_text, c.field)),
  );
  return {
    doc_id: env.id, tp, fp: fp.length, fn: fn.length, proposals: run.proposals.length, verified: claims.length, dropped: droppedBy, by_field: byField,
    fp_items: fp.map(item), fn_items: fn.map(item), fp_matching_blocked: fpBlocked.map(item),
  };
}

const sumCounts = (xs: Counts[]) => ({ tp: xs.reduce((a, x) => a + x.tp, 0), fp: xs.reduce((a, x) => a + x.fp, 0), fn: xs.reduce((a, x) => a + x.fn, 0) });
const metrics = (c: Counts) => ({ ...c, precision: wilson(c.tp, c.tp + c.fp), recall: wilson(c.tp, c.tp + c.fn), f1: f1(c.tp, c.fp, c.fn) });

const sumBy = (xs: Record<string, number>[]) => {
  const out: Record<string, number> = {};
  for (const x of xs) for (const [k, v] of Object.entries(x)) out[k] = (out[k] ?? 0) + v;
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
};

function usageStats(runs: RunRecord[]) {
  const withUsage = runs.filter((r) => r.error === null && r.usage);
  const sum = (pick: (u: NonNullable<RunRecord["usage"]>) => number) => withUsage.reduce((a, r) => a + pick(r.usage!), 0);
  const n = withUsage.length;
  const mean = (x: number) => (n ? Math.round(x / n) : null);
  const [input, output, reasoning, total] = [sum((u) => u.input), sum((u) => u.output), sum((u) => u.reasoning ?? 0), sum((u) => u.total)];
  return {
    calls: n,
    reasoning_reported: withUsage.filter((r) => r.usage!.reasoning !== null).length,
    sum: { input, output, reasoning, total },
    mean_per_document: { input: mean(input), output: mean(output), reasoning: mean(reasoning), total: mean(total) },
  };
}

function latencyStats(runs: RunRecord[]) {
  const xs = runs.filter((r) => r.error === null && r.latency_ms !== null).map((r) => r.latency_ms!);
  return { median_ms: median(xs), p90_ms: percentile(xs, 0.9), max_ms: xs.length ? Math.max(...xs) : null };
}

/** Is the quote inside the window text (whitespace, quotes, dashes, ligatures normalized)? */
export const quoteInWindow = (windowText: string, quote: string) => normalizeForMatch(windowText).value.includes(normalizeForMatch(quote).value);

export function score(input: ScoreInput) {
  const envs = new Map(input.docs.map((d) => [d.id, d]));

  // Gold: verified once through the same path.
  const goldClaims = new Map<string, Claim[]>();
  const goldBlocked = new Map<string, DroppedClaim[]>();
  const blocked: { doc_id: string; field: string; asset_code: string; value_text: string; reason: string }[] = [];
  const staleGold: string[] = [];
  const byOrigin: Record<string, number> = {};
  let goldItems = 0;
  let goldVerifiable = 0;
  for (const g of [...input.gold].sort((a, b) => a.id.localeCompare(b.id))) {
    const env = envs.get(g.id);
    if (!env || env.text_sha256 !== g.text_sha256) {
      staleGold.push(g.id);
      continue;
    }
    const { claims, dropped } = env.verify(g.items.map(toProposal), "operator-reviewed");
    goldClaims.set(g.id, claims);
    goldBlocked.set(g.id, dropped);
    goldItems += g.items.length;
    goldVerifiable += claims.length;
    for (const it of g.items) addTo(byOrigin, it.origin);
    for (const d of dropped) blocked.push({ doc_id: g.id, field: d.field, asset_code: d.asset_code, value_text: d.value_text, reason: d.reason });
  }
  const docsWithoutGold = input.docs.filter((d) => !goldClaims.has(d.id)).map((d) => d.id).sort();

  // Per config.
  const configs: Record<string, ReturnType<typeof configReport>> = {};
  const scoredByConfig: Record<string, Map<string, DocScore>> = {};
  const configNames = Object.keys(input.runs).sort();

  function configReport(name: string) {
    const runs = [...input.runs[name]].sort((a, b) => a.doc_id.localeCompare(b.doc_id));
    const scored = new Map<string, DocScore>();
    const failed: { doc_id: string; error: string; attempts: number }[] = [];
    const staleRuns: string[] = [];
    const current: RunRecord[] = [];
    for (const r of runs) {
      const env = envs.get(r.doc_id);
      // A run made with another model, options, prompt, or text is not a run of this config as it stands now.
      if (!env || env.text_sha256 !== r.text_sha256 || r.key !== input.expectedKey(name, r.doc_id)) {
        staleRuns.push(r.doc_id);
        continue;
      }
      current.push(r);
      if (r.error !== null) {
        failed.push({ doc_id: r.doc_id, error: r.error, attempts: r.attempts });
        continue;
      }
      const gold = goldClaims.get(r.doc_id);
      if (gold) scored.set(r.doc_id, scoreDoc(env, r, gold, goldBlocked.get(r.doc_id) ?? []));
    }
    const distinct = (pick: (r: RunRecord) => unknown) => [...new Set(current.filter((r) => r.error === null).map((r) => JSON.stringify(pick(r))))].map((x) => JSON.parse(x));
    const models = distinct((r) => r.model);
    const options = distinct((r) => r.provider_options);
    const promptVersions = distinct((r) => r.prompt_version);
    if (models.length > 1 || options.length > 1 || promptVersions.length > 1) {
      throw new Error(`Config "${name}" has runs with different models, provider options, or prompt versions; re-run with --force so they agree.`);
    }
    scoredByConfig[name] = scored;
    const docs = [...scored.values()];
    const fields: Record<string, Counts> = {};
    for (const d of docs) {
      for (const [f, c] of Object.entries(d.by_field)) {
        const t = (fields[f] ??= { tp: 0, fp: 0, fn: 0 });
        t.tp += c.tp;
        t.fp += c.fp;
        t.fn += c.fn;
      }
    }
    return {
      model: (models[0] as string | undefined) ?? null,
      provider_options: options[0] ?? null,
      prompt_version: (promptVersions[0] as string | undefined) ?? null,
      response_models: [...new Set(current.map((r) => r.response_model).filter((m): m is string => typeof m === "string"))].sort(),
      documents_with_run: current.length,
      documents_scored: docs.length,
      proposals: docs.reduce((a, d) => a + d.proposals, 0),
      verified: docs.reduce((a, d) => a + d.verified, 0),
      dropped_by_reason: sumBy(docs.map((d) => d.dropped)),
      ...metrics(sumCounts(docs)),
      by_field: Object.fromEntries(Object.entries(fields).sort(([a], [b]) => a.localeCompare(b))),
      fp_matching_blocked_gold: {
        count: docs.reduce((a, d) => a + d.fp_matching_blocked.length, 0),
        note: "Diagnostic only: false positives that equal a gold item the verifier blocked. Not part of the headline numbers.",
        items: docs.flatMap((d) => d.fp_matching_blocked.map((i) => ({ doc_id: d.doc_id, ...i }))),
      },
      tokens: usageStats(current),
      latency: latencyStats(current),
      errors: failed.length,
      retried_documents: current.filter((r) => r.attempts > 1).length,
      failed_documents: failed,
      stale_runs: staleRuns,
      per_document: docs,
    };
  }
  for (const name of configNames) configs[name] = configReport(name);

  // Head-to-head on documents every config scored.
  const common = configNames.length
    ? [...(scoredByConfig[configNames[0]]?.keys() ?? [])].filter((id) => configNames.every((n) => scoredByConfig[n].has(id))).sort()
    : [];
  const headToHead = {
    documents: common,
    configs: Object.fromEntries(configNames.map((n) => [n, metrics(sumCounts(common.map((id) => scoredByConfig[n].get(id)!)))])),
  };

  // Window check for operator-reviewed claims already stored.
  const reviewed = input.reviewedClaims.filter((c) => c.field_source === "operator-reviewed");
  const outside: { doc_id: string; field: string; asset: string; value_text: string }[] = [];
  let inside = 0;
  let noWindow = 0;
  for (const c of [...reviewed].sort(claimOrder)) {
    const env = input.docs.find((d) => d.doc_key === c.doc_key);
    if (!env) {
      noWindow++;
      continue;
    }
    if (quoteInWindow(env.window_text, c.quote)) inside++;
    else outside.push({ doc_id: env.id, field: c.field, asset: c.asset, value_text: c.value_text });
  }

  return {
    gold: {
      documents: goldClaims.size,
      items: goldItems,
      verifiable: goldVerifiable,
      by_origin: Object.fromEntries(Object.entries(byOrigin).sort(([a], [b]) => a.localeCompare(b))),
      verifier_blocked: blocked.length,
      verifier_blocked_by_reason: sumBy(blocked.map((b) => ({ [b.reason]: 1 }))),
      blocked_items: blocked,
      stale_gold: staleGold,
    },
    documents_without_gold: docsWithoutGold,
    configs,
    head_to_head: headToHead,
    window: {
      operator_reviewed_claims: reviewed.length,
      inside,
      outside: outside.length,
      without_document: noWindow,
      outside_items: outside,
      coverage: input.docs
        .map((d) => ({ doc_id: d.id, window_chars: d.window_chars, full_chars: d.full_chars, ratio: round(d.window_chars / d.full_chars) }))
        .sort((a, b) => a.doc_id.localeCompare(b.doc_id)),
    },
  };
}

export type Scores = ReturnType<typeof score>;

// ---------- report ----------

const pct = (r: Rate) => (r.value === null ? "n/a" : `${(r.value * 100).toFixed(1)}% (${(r.low! * 100).toFixed(1)}-${(r.high! * 100).toFixed(1)})`);

/** Markdown tables for the terminal. */
export function renderMarkdown(s: Scores) {
  const out: string[] = [];
  const names = Object.keys(s.configs);
  out.push(`Gold: ${s.gold.documents} documents, ${s.gold.items} items, ${s.gold.verifiable} verifiable, ${s.gold.verifier_blocked} verifier-blocked${s.gold.stale_gold.length ? `, ${s.gold.stale_gold.length} stale file(s)` : ""}.`);
  if (s.documents_without_gold.length) out.push(`Documents without a gold file: ${s.documents_without_gold.length}.`);
  if (names.length === 0) {
    out.push("", "No benchmark runs found in data/benchmark/runs/.");
  } else {
    out.push("", "| config | docs scored | proposals | verified | TP | FP | FN | precision (95% CI) | recall (95% CI) | F1 |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const n of names) {
      const c = s.configs[n];
      out.push(`| ${n} | ${c.documents_scored} | ${c.proposals} | ${c.verified} | ${c.tp} | ${c.fp} | ${c.fn} | ${pct(c.precision)} | ${pct(c.recall)} | ${c.f1 ?? "n/a"} |`);
    }
    out.push("", "| config | tokens total (sum / mean per doc) | reasoning (sum) | latency median / p90 / max ms | errors | retried docs |", "| --- | --- | --- | --- | --- | --- |");
    for (const n of names) {
      const c = s.configs[n];
      out.push(`| ${n} | ${c.tokens.sum.total} / ${c.tokens.mean_per_document.total ?? "n/a"} | ${c.tokens.sum.reasoning} | ${c.latency.median_ms ?? "n/a"} / ${c.latency.p90_ms ?? "n/a"} / ${c.latency.max_ms ?? "n/a"} | ${c.errors} | ${c.retried_documents} |`);
    }
    out.push("", `Head-to-head on ${s.head_to_head.documents.length} documents scored by every config:`, "", "| config | TP | FP | FN | precision (95% CI) | recall (95% CI) | F1 |", "| --- | --- | --- | --- | --- | --- | --- |");
    for (const n of names) {
      const c = s.head_to_head.configs[n];
      out.push(`| ${n} | ${c.tp} | ${c.fp} | ${c.fn} | ${pct(c.precision)} | ${pct(c.recall)} | ${c.f1 ?? "n/a"} |`);
    }
    for (const n of names) {
      const c = s.configs[n];
      if (c.failed_documents.length) out.push("", `${n}: failed documents ${c.failed_documents.map((f) => f.doc_id).join(", ")}`);
      if (c.stale_runs.length) out.push("", `${n}: stale runs not scored (config, prompt, or text changed since): ${c.stale_runs.join(", ")}`);
      if (c.fp_matching_blocked_gold.count) out.push("", `${n}: ${c.fp_matching_blocked_gold.count} false positive(s) equal a verifier-blocked gold item (diagnostic, not in the numbers above).`);
    }
  }
  out.push("", `Window check: ${s.window.inside} of ${s.window.operator_reviewed_claims} operator-reviewed claims have their quote inside the window, ${s.window.outside} outside${s.window.without_document ? `, ${s.window.without_document} without a candidate document` : ""}.`);
  return out.join("\n");
}

