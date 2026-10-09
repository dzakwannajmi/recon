import { describe, expect, it } from "vitest";
import type { ProposedClaim } from "../claims/fields";
import type { Claim, DroppedClaim } from "../claims/store";
import type { RunRecord } from "./run";
import { assetCanon, claimsMatch, f1, matchOneToOne, median, normalizeText, normalizeValue, percentile, quoteInWindow, renderMarkdown, sameValue, score, wilson, type GoldFile, type ScoreDocEnv } from "./score";

const expectedKey = () => "k";
const claim = (o: Partial<Claim> & { id: string }): Claim => ({ asset: "AAA:G1", field: "custodian", value: "Acme Bank", as_of: null, quote: "q", value_text: "Acme Bank", field_source: "llm", doc_key: "d1|A:1", ...o }) as Claim;

describe("value rules", () => {
  it("compares text lowercase without non-alphanumerics, numbers exactly", () => {
    expect(normalizeText("Acme  Bank, N.A.")).toBe("acmebankna");
    expect(sameValue("Acme Bank, N.A.", "acme bank NA")).toBe(true);
    expect(sameValue("Acme Bank", "Acme Trust")).toBe(false);
    expect(sameValue(100, 100)).toBe(true);
    expect(sameValue(100, 100.5)).toBe(false);
    expect(sameValue(100, "100")).toBe(false);
    expect(sameValue("2026-08-31", "2026-08-31")).toBe(true);
    expect(sameValue("2026-08-31", "2026-09-30")).toBe(false);
  });

  it("requires the same asset and field, and equal as_of only when both have one", () => {
    const a = claim({ id: "a", as_of: "2026-08-31" });
    expect(claimsMatch(a, claim({ id: "b", as_of: "2026-08-31" }))).toBe(true);
    expect(claimsMatch(a, claim({ id: "b", as_of: null }))).toBe(true);
    expect(claimsMatch(a, claim({ id: "b", as_of: "2026-09-30" }))).toBe(false);
    expect(claimsMatch(a, claim({ id: "b", as_of: "2026-08-31", asset: "BBB:G2" }))).toBe(false);
    expect(claimsMatch(a, claim({ id: "b", as_of: "2026-08-31", field: "auditor" }))).toBe(false);
  });
});

describe("matchOneToOne", () => {
  it("pairs each gold claim at most once", () => {
    const m = [claim({ id: "m1" }), claim({ id: "m2" })];
    const g = [claim({ id: "g1" })];
    const r = matchOneToOne(m, g);
    expect(r.tp).toBe(1);
    expect(r.fp).toHaveLength(1);
    expect(r.fn).toHaveLength(0);
  });

  it("finds the maximum pairing when a claim without a date could fit several gold claims", () => {
    // Model claim x (no date) fits both gold dates; y (dated Aug) fits only the Aug one. Greedy on x would lose y.
    const x = claim({ id: "x", as_of: null });
    const y = claim({ id: "y", as_of: "2026-08-31" });
    const gAug = claim({ id: "gAug", as_of: "2026-08-31" });
    const gSep = claim({ id: "gSep", as_of: "2026-09-30" });
    const r = matchOneToOne([x, y], [gAug, gSep]);
    expect(r.tp).toBe(2);
    expect(r.fp).toHaveLength(0);
    expect(r.fn).toHaveLength(0);
  });

  it("counts unmatched gold as false negatives", () => {
    const r = matchOneToOne([], [claim({ id: "g1" }), claim({ id: "g2", field: "auditor" })]);
    expect(r).toMatchObject({ tp: 0 });
    expect(r.fn).toHaveLength(2);
  });
});

describe("statistics", () => {
  it("computes the Wilson 95% interval", () => {
    const w = wilson(8, 10);
    expect(w.value).toBe(0.8);
    expect(w.low).toBeCloseTo(0.4902, 3);
    expect(w.high).toBeCloseTo(0.9433, 3);
    expect(wilson(0, 0)).toEqual({ value: null, low: null, high: null, n: 0 });
    const all = wilson(5, 5);
    expect(all.high).toBe(1);
    expect(all.low).toBeCloseTo(0.5655, 3);
    expect(wilson(0, 5).low).toBe(0);
  });

  it("computes F1, median, and nearest-rank percentiles", () => {
    expect(f1(8, 2, 2)).toBe(0.8);
    expect(f1(0, 0, 0)).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBe(9);
    expect(percentile([5], 0.9)).toBe(5);
  });

  it("matches a quote inside the window despite whitespace and typographic differences", () => {
    expect(quoteInWindow("[page 1]\nThe custodian is\nAcme Bank.", "custodian is Acme Bank.")).toBe(true);
    expect(quoteInWindow("[page 1]\nThe custodian is Acme Bank.", "auditor is Acme Bank.")).toBe(false);
  });
});

describe("adjudication rules", () => {
  it("networks ignore the generic words blockchain, network, chain, and mainnet, for networks only", () => {
    expect(sameValue("Stellar Blockchain", "Stellar", "networks")).toBe(true);
    expect(sameValue("Provenance Blockchain", "provenance", "networks")).toBe(true);
    expect(sameValue("Stellar Mainnet", "Stellar network", "networks")).toBe(true);
    expect(sameValue("Ethereum", "Stellar", "networks")).toBe(false);
    // Whole words only, and only for networks.
    expect(normalizeValue("Blockchains Inc", "networks")).toBe("blockchainsinc");
    expect(sameValue("Stellar Blockchain", "Stellar", "custodian")).toBe(false);
    expect(sameValue("Stellar Blockchain", "Stellar")).toBe(false);
    // Nothing left after dropping the words: fall back to the plain value.
    expect(normalizeValue("Network", "networks")).toBe("network");
    // Combined values stay strict.
    expect(sameValue("UMB Bank N.A. and Flagstar Bank, N.A.", "UMB Bank N.A.")).toBe(false);
  });

  it("an issuer-level claim equals the asset only in a single-asset document with that official domain", () => {
    const single = assetCanon(["AAA:G1"], ["acme.com"]);
    expect(single.key("ISSUER:acme.com")).toBe("AAA:G1");
    expect(single.key("ISSUER:other.com")).toBe("ISSUER:other.com");
    expect(single.key("AAA:G1")).toBe("AAA:G1");
    expect(single.code("ISSUER")).toBe("AAA");
    const multi = assetCanon(["AAA:G1", "BBB:G2"], ["acme.com"]);
    expect(multi.key("ISSUER:acme.com")).toBe("ISSUER:acme.com");
    expect(multi.code("ISSUER")).toBe("ISSUER");
    const a = claim({ id: "a", asset: "ISSUER:acme.com" });
    const b = claim({ id: "b", asset: "AAA:G1" });
    expect(claimsMatch(a, b)).toBe(false);
    expect(claimsMatch(a, b, single)).toBe(true);
    expect(claimsMatch(a, b, multi)).toBe(false);
  });
});

// ---------- end to end with a fake verifier ----------

/** A fake verifier: value_text "9"-like becomes a number; a quote starting with BAD is dropped. */
function fakeEnv(id: string, over: Partial<ScoreDocEnv> = {}): ScoreDocEnv {
  return {
    id, doc_key: `${id}|A:1`, url: `https://example.com/${id}`, text_sha256: `t-${id}`, window_chars: 100, full_chars: 400, window_text: "The custodian is Acme Bank. Net assets were 100.",
    verify: (proposals: ProposedClaim[], fieldSource) => {
      const claims: Claim[] = [];
      const dropped: DroppedClaim[] = [];
      for (const p of proposals) {
        if (p.quote.startsWith("BAD")) {
          dropped.push({ reason: "quote_not_found", field: p.field, asset_code: p.asset_code, value_text: p.value_text, quote: p.quote } as DroppedClaim);
          continue;
        }
        const n = Number(p.value_text);
        claims.push(claim({ id: `${p.field}-${p.value_text}`, asset: p.asset_code === "ISSUER" ? "ISSUER:acme.com" : `${p.asset_code}:G1`, field: p.field, value: Number.isNaN(n) ? p.value_text : n, quote: p.quote, value_text: p.value_text, field_source: fieldSource }));
      }
      return { claims, dropped };
    },
    ...over,
  };
}

const prop = (field: ProposedClaim["field"], value_text: string, quote = "quote text long enough"): ProposedClaim => ({ field, asset_code: "AAA", value_text, unit: null, as_of_text: null, quote, page: null });

const goldFile = (id: string, items: GoldFile["items"], text_sha256 = `t-${id}`): GoldFile => ({
  id, doc_key: `${id}|A:1`, source_url: "u", text_sha256, window: { labels: ["part 1"], chars: 100 }, labeled_by: "reader", checked_by: "operator", labeled_at: "2026-10-08", items,
});
const gItem = (field: ProposedClaim["field"], value_text: string, quote = "quote text long enough"): GoldFile["items"][number] => ({ ...prop(field, value_text, quote), origin: "reader" });

const run = (config: string, doc_id: string, proposals: ProposedClaim[], over: Partial<RunRecord> = {}): RunRecord => ({
  key: "k", config, doc_id, doc_key: `${doc_id}|A:1`, source_url: "u", text_sha256: `t-${doc_id}`, model: `m-${config}`, provider_options: {}, prompt_version: "p", chunks_sent: 1, chars_sent: 100,
  proposals, usage: { input: 1000, output: 100, reasoning: 10, total: 1100 }, latency_ms: 1000, attempts: 1, error: null, at: "t", ...over,
});

describe("score", () => {
  const docs = [fakeEnv("d1"), fakeEnv("d2"), fakeEnv("d3")];
  const gold = [
    goldFile("d1", [gItem("custodian", "Acme Bank"), gItem("net_assets", "100"), gItem("auditor", "BAD Firm", "BAD quote not verifiable")]),
    goldFile("d2", [gItem("custodian", "Acme Bank")]),
  ];

  it("counts TP, FP, FN per config and excludes verifier-blocked gold from recall", () => {
    const s = score({
      docs, gold, expectedKey, reviewedClaims: [],
      runs: {
        good: [run("good", "d1", [prop("custodian", "Acme Bank"), prop("net_assets", "100"), prop("auditor", "Other Firm"), prop("networks", "BAD net", "BAD quote")]), run("good", "d2", [prop("custodian", "Acme Bank")])],
      },
    });
    expect(s.gold).toMatchObject({ documents: 2, items: 4, verifiable: 3, verifier_blocked: 1, verifier_blocked_by_reason: { quote_not_found: 1 } });
    const c = s.configs.good;
    expect(c).toMatchObject({ documents_scored: 2, proposals: 5, verified: 4, tp: 3, fp: 1, fn: 0 });
    expect(c.dropped_by_reason).toEqual({ quote_not_found: 1 });
    expect(c.precision.value).toBe(0.75);
    expect(c.recall.value).toBe(1);
    expect(c.by_field.auditor).toEqual({ tp: 0, fp: 1, fn: 0 });
    expect(c.per_document[0].fp_items[0]).toMatchObject({ field: "auditor", value_text: "Other Firm" });
    expect(c.tokens.sum).toEqual({ input: 2000, output: 200, reasoning: 20, total: 2200 });
    expect(c.tokens.mean_per_document.total).toBe(1100);
    expect(c.latency).toEqual({ median_ms: 1000, p90_ms: 1000, max_ms: 1000 });
    expect(s.documents_without_gold).toEqual(["d3"]);
  });

  it("leaves failed runs out of the scores, lists them, and restricts head-to-head to common documents", () => {
    const s = score({
      docs, gold, expectedKey, reviewedClaims: [],
      runs: {
        a: [run("a", "d1", [prop("custodian", "Acme Bank")]), run("a", "d2", [prop("custodian", "Acme Bank")])],
        b: [run("b", "d1", [], { error: "503", attempts: 2, usage: null, latency_ms: 50 }), run("b", "d2", [prop("custodian", "Other")])],
      },
    });
    expect(s.configs.b).toMatchObject({ documents_scored: 1, errors: 1, retried_documents: 1, tp: 0, fp: 1, fn: 1 });
    expect(s.configs.b.failed_documents).toEqual([{ doc_id: "d1", error: "503", attempts: 2 }]);
    expect(s.head_to_head.documents).toEqual(["d2"]);
    expect(s.head_to_head.configs.a).toMatchObject({ tp: 1, fp: 0, fn: 0 });
    expect(s.head_to_head.configs.b).toMatchObject({ tp: 0, fp: 1, fn: 1 });
  });

  it("ignores gold and runs whose text hash no longer matches the snapshot", () => {
    const s = score({ docs, gold: [goldFile("d1", [gItem("custodian", "Acme Bank")], "old-hash")], expectedKey, reviewedClaims: [], runs: { a: [run("a", "d1", [prop("custodian", "Acme Bank")])] } });
    expect(s.gold.stale_gold).toEqual(["d1"]);
    expect(s.configs.a.documents_scored).toBe(0);
    const s2 = score({ docs, gold, expectedKey, reviewedClaims: [], runs: { a: [run("a", "d2", [], { text_sha256: "changed" })] } });
    expect(s2.configs.a).toMatchObject({ documents_scored: 0, stale_runs: ["d2"] });
  });

  it("checks operator-reviewed quotes against the window and reports coverage", () => {
    const reviewed = [
      claim({ id: "r1", field_source: "operator-reviewed", quote: "The custodian is Acme Bank." }),
      claim({ id: "r2", field_source: "operator-reviewed", quote: "Appears only outside the window" }),
      claim({ id: "r3", field_source: "operator-reviewed", doc_key: "unknown|A:1" }),
      claim({ id: "r4", field_source: "llm", quote: "ignored" }),
    ];
    const s = score({ docs, gold: [], runs: {}, expectedKey, reviewedClaims: reviewed });
    expect(s.window).toMatchObject({ operator_reviewed_claims: 3, inside: 1, outside: 1, without_document: 1 });
    expect(s.window.coverage[0]).toEqual({ doc_id: "d1", window_chars: 100, full_chars: 400, ratio: 0.25 });
  });

  it("handles no inputs at all, deterministically", () => {
    const empty = { docs: [], gold: [], runs: {}, expectedKey, reviewedClaims: [] };
    const s = score(empty);
    expect(JSON.stringify(score(empty))).toBe(JSON.stringify(s));
    expect(s.gold).toMatchObject({ documents: 0, items: 0 });
    expect(renderMarkdown(s)).toContain("No benchmark runs found");
  });

  it("renders a markdown table", () => {
    const s = score({ docs, gold, expectedKey, reviewedClaims: [], runs: { good: [run("good", "d2", [prop("custodian", "Acme Bank")])] } });
    const md = renderMarkdown(s);
    expect(md).toContain("| good | 1 |");
    expect(md).toContain("Head-to-head on 1 documents");
  });

  it("treats a run made with another config key as stale and does not score it", () => {
    const s = score({
      docs, gold, expectedKey: (c, d) => (c === "a" && d === "d1" ? "current" : "k"), reviewedClaims: [],
      runs: { a: [run("a", "d1", [prop("custodian", "Acme Bank")]), run("a", "d2", [prop("custodian", "Acme Bank")])] },
    });
    expect(s.configs.a).toMatchObject({ documents_scored: 1, stale_runs: ["d1"], documents_with_run: 1 });
    expect(renderMarkdown(s)).toContain("stale runs not scored");
    // An unknown config has no expected key: everything is stale.
    const unknown = score({ docs, gold, expectedKey: () => null, reviewedClaims: [], runs: { z: [run("z", "d1", [])] } });
    expect(unknown.configs.z).toMatchObject({ documents_scored: 0, stale_runs: ["d1"] });
  });

  it("reports model, options, and prompt version, and fails when scored runs mix them", () => {
    const s = score({ docs, gold, expectedKey, reviewedClaims: [], runs: { a: [run("a", "d1", [], { response_model: "gemini-x-001" })] } });
    expect(s.configs.a).toMatchObject({ model: "m-a", prompt_version: "p", provider_options: {}, response_models: ["gemini-x-001"] });
    expect(() =>
      score({ docs, gold, expectedKey, reviewedClaims: [], runs: { a: [run("a", "d1", []), run("a", "d2", [], { model: "other" })] } }),
    ).toThrow(/different models/);
  });

  it("treats a run record without a provider as google, and reports the provider", () => {
    const s = score({ docs, gold, expectedKey, reviewedClaims: [], runs: { a: [run("a", "d1", [])], b: [run("b", "d1", [], { provider: "groq" })] } });
    expect(s.configs.a.provider).toBe("google");
    expect(s.configs.b.provider).toBe("groq");
    expect(() =>
      score({ docs, gold, expectedKey, reviewedClaims: [], runs: { a: [run("a", "d1", []), run("a", "d2", [], { provider: "groq" })] } }),
    ).toThrow(/different models, providers/);
  });

  it("flags false positives that equal a verifier-blocked gold item, outside the headline numbers", () => {
    const s = score({
      docs, gold, expectedKey, reviewedClaims: [],
      // The gold auditor item "BAD Firm" is blocked; the model proposes the same value with a quote the verifier accepts.
      runs: { a: [run("a", "d1", [prop("custodian", "Acme Bank"), prop("net_assets", "100"), prop("auditor", "bad firm")])] },
    });
    expect(s.configs.a).toMatchObject({ tp: 2, fp: 1, fn: 0 });
    expect(s.configs.a.fp_matching_blocked_gold.count).toBe(1);
    expect(s.configs.a.fp_matching_blocked_gold.items[0]).toMatchObject({ doc_id: "d1", field: "auditor" });
    expect(renderMarkdown(s)).toContain("verifier-blocked gold item");
  });

  it("matches ISSUER claims to the single asset only through the document's canon", () => {
    const strictDoc = fakeEnv("d1");
    const canonDoc = fakeEnv("d1", { canon: assetCanon(["AAA:G1"], ["acme.com"]) });
    const issuerGold = goldFile("d1", [{ ...gItem("custodian", "Acme Bank"), asset_code: "ISSUER" }]);
    const runs = { a: [run("a", "d1", [prop("custodian", "Acme Bank")])] };
    expect(score({ docs: [strictDoc], gold: [issuerGold], expectedKey, reviewedClaims: [], runs }).configs.a).toMatchObject({ tp: 0, fp: 1, fn: 1 });
    expect(score({ docs: [canonDoc], gold: [issuerGold], expectedKey, reviewedClaims: [], runs }).configs.a).toMatchObject({ tp: 1, fp: 0, fn: 0 });
  });

  it("counts per-field true positives from the matching, not from claim ids", () => {
    // Two different claims share one id; only one of them matches the gold item.
    const env = fakeEnv("d1", {
      verify: (_, source) => ({
        claims:
          source === "llm"
            ? [claim({ id: "same", value: "Aaa Bank", value_text: "Aaa Bank" }), claim({ id: "same", value: "Acme Bank", value_text: "Acme Bank" })]
            : [claim({ id: "gold", value: "Acme Bank", value_text: "Acme Bank" })],
        dropped: [],
      }),
    });
    const s = score({ docs: [env], gold: [goldFile("d1", [gItem("custodian", "Acme Bank")])], expectedKey, reviewedClaims: [], runs: { a: [run("a", "d1", [prop("custodian", "x")])] } });
    expect(s.configs.a.by_field.custodian).toEqual({ tp: 1, fp: 1, fn: 0 });
  });
});
