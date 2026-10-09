import { describe, expect, it } from "vitest";
import type { UniverseAsset } from "../chain/universe";
import { ISSUER, KEY } from "./fixtures";
import { NO_REVIEW_CRITICAL, assetEvidenceHash, assetStatus as statusOf, canonicalJson, parseReviews, reviewKey, type AssetContext, type Review } from "./status";
import { FLAG_BITS, FLAG_ORDER, STATUS_CODES, clear, notEvaluated, raised, type Evaluation, type EvidenceRef, type RaisedEvaluation } from "./types";

const asset = { asset_code: "BB1", issuer: ISSUER, issuer_org: "Bit Bond", asset_type: "bond" } as UniverseAsset;
const SAC = "CBLV4ATSIWU67CFSQU2NVRKINQIKUZ2ODSZBUJTJ43VJVRSBTZYOPNUR";
const INPUTS = { checks: { path: "data/checks/2026-10-08.json", sha256: "aa", checked_at: "2026-10-08T01:34:10.993Z" }, claims: { path: "data/claims/claims.json", sha256: "bb" } };
/** Context with a change time set, so tests that raise FLAG_CHANGE publish. */
const CTX: AssetContext = {
  feed_schema: 1, rules_version: "flags-v2", inputs: INPUTS, sac_contract_id: SAC,
  checked_at: "2026-10-08T01:34:19.579Z", issuer_change_seen_at: "2026-10-08T01:34:19.579Z",
};
const assetStatus = (a: UniverseAsset, e: readonly Evaluation[], r: readonly Review[], ctx: AssetContext = CTX) => statusOf(a, e, r, ctx);
const doc = (quote = "q1", sha = "sha-a"): EvidenceRef[] => [{ kind: "source_fact", ref: sha, snapshot_sha256: sha, quote }];

/** All nine flags clear, with overrides. */
function evals(over: Partial<Record<(typeof FLAG_ORDER)[number], Evaluation>> = {}): Evaluation[] {
  return FLAG_ORDER.map((f) => over[f] ?? clear(f, "ok", "2026-10-08", []));
}
const supplyCritical = (statement = "Mismatch of 130.", evidence = doc()) => raised("SUPPLY_MISMATCH", "CRITICAL", statement, "2026-10-08", evidence);
const review = (key: string, decision: "confirm" | "reject"): Review => ({ asset: KEY, flag: "SUPPLY_MISMATCH", review_key: key, decision, by: "op", at: "2026-10-08" });

describe("one evaluation per flag", () => {
  it("throws on an empty list, a missing flag, or a duplicate, never publishing OK", () => {
    expect(() => assetStatus(asset, [], [])).toThrow(/expected exactly one evaluation/);
    expect(() => assetStatus(asset, evals().filter((e) => e.flag !== "ISSUER_IDENTITY"), [])).toThrow(/got 8/);
    expect(() => assetStatus(asset, [...evals(), clear("FLAG_CHANGE", "again", "d", [])], [])).toThrow(/got 10/);
    // nine entries, but one flag twice and another missing
    expect(() => assetStatus(asset, [...evals().filter((e) => e.flag !== "FLAG_CHANGE"), clear("SIGNER_CHANGE", "dup", "d", [])], [])).toThrow(/expected exactly one/);
  });
});

describe("bits and codes", () => {
  it("keeps the append-only feed numbering", () => {
    expect(FLAG_BITS).toEqual({ ISSUER_IDENTITY: 0, SUPPLY_MISMATCH: 1, STALE_ATTESTATION: 2, FLAG_CHANGE: 3, SIGNER_CHANGE: 4, LARGE_MINT_BURN: 5, PRICE_DEVIATION: 6, NO_PUBLIC_DOCS: 7, TOML_INCONSISTENT: 8 });
    expect(STATUS_CODES).toEqual({ OK: 0, WARNING: 1, CRITICAL: 2 });
  });
});

describe("assetStatus", () => {
  it("is OK with bitmask 0 when nothing is raised", () => {
    const s = assetStatus(asset, evals(), []);
    expect(s).toMatchObject({ asset: KEY, status: "OK", status_code: 0, flags_bitmask: 0, raised: [] });
    expect(s.clear).toHaveLength(9);
  });

  it("is WARNING and sets the bits of the raised flags", () => {
    const s = assetStatus(asset, evals({
      FLAG_CHANGE: raised("FLAG_CHANGE", "WARNING", "x", "d", []), TOML_INCONSISTENT: raised("TOML_INCONSISTENT", "WARNING", "y", "d", []),
    }), []);
    expect(s).toMatchObject({ status: "WARNING", status_code: 1, flags_bitmask: (1 << 3) | (1 << 8) });
    expect(s.raised.map((r) => r.flag)).toEqual(["FLAG_CHANGE", "TOML_INCONSISTENT"]);
    expect(s.raised[0]).toMatchObject({ review: "not_needed", review_key: null, effective_severity: "WARNING", document_derived: false });
  });

  it("is CRITICAL for an identity CRITICAL without review (chain + protocol check)", () => {
    const s = assetStatus(asset, evals({ ISSUER_IDENTITY: raised("ISSUER_IDENTITY", "CRITICAL", "x", "d", [{ kind: "chain_check", ref: "r" }]) }), []);
    expect(s).toMatchObject({ status: "CRITICAL", status_code: 2, flags_bitmask: 1 });
    expect(s.raised[0]).toMatchObject({ review: "not_needed", effective_severity: "CRITICAL" });
  });

  it("is null (not published) when the issuer identity could not be checked", () => {
    const s = assetStatus(asset, evals({ ISSUER_IDENTITY: notEvaluated("ISSUER_IDENTITY", "no check") }), []);
    expect(s).toMatchObject({ status: null, status_code: null });
    expect(s.not_evaluated).toHaveLength(1);
  });

  it("sets no bits for an unpublished asset but keeps its raised flags listed", () => {
    const s = assetStatus(asset, evals({ ISSUER_IDENTITY: notEvaluated("ISSUER_IDENTITY", "no check"), FLAG_CHANGE: raised("FLAG_CHANGE", "WARNING", "x", "d", []) }), []);
    expect(s).toMatchObject({ status: null, status_code: null, flags_bitmask: 0 });
    expect(s.raised.map((r) => r.flag)).toEqual(["FLAG_CHANGE"]);
  });

  it("only the identity flag may be CRITICAL without review", () => {
    expect([...NO_REVIEW_CRITICAL]).toEqual(["ISSUER_IDENTITY"]);
  });

  it("keeps a CRITICAL without document evidence pending forever (no key to confirm)", () => {
    const e = raised("SUPPLY_MISMATCH", "CRITICAL", "x", "d", [{ kind: "examination", ref: "data/examinations/2026-10-08.json#a#b" }]);
    const s = assetStatus(asset, evals({ SUPPLY_MISMATCH: e }), [review("a".repeat(64), "confirm"), review(reviewKey(KEY, e), "confirm")]);
    expect(s).toMatchObject({ status: "WARNING" });
    expect(s.raised[0]).toMatchObject({ review: "pending", review_key: null, effective_severity: "WARNING", document_derived: false });
    const other = assetStatus(asset, evals({ FLAG_CHANGE: raised("FLAG_CHANGE", "CRITICAL", "x", "d", []) }), []);
    expect(other.raised[0]).toMatchObject({ review: "pending", effective_severity: "WARNING" });
  });

  it("keeps a document-derived CRITICAL pending, counted as WARNING, until confirmed", () => {
    const e = supplyCritical();
    const key = reviewKey(KEY, e);
    const pending = assetStatus(asset, evals({ SUPPLY_MISMATCH: e }), []);
    expect(pending).toMatchObject({ status: "WARNING", flags_bitmask: 2 });
    expect(pending.raised[0]).toMatchObject({ review: "pending", review_key: key, effective_severity: "WARNING", severity: "CRITICAL", document_derived: true });

    const confirmed = assetStatus(asset, evals({ SUPPLY_MISMATCH: e }), [review(key, "confirm")]);
    expect(confirmed).toMatchObject({ status: "CRITICAL", status_code: 2 });
    expect(confirmed.raised[0]).toMatchObject({ review: "confirmed", effective_severity: "CRITICAL" });

    const rejected = assetStatus(asset, evals({ SUPPLY_MISMATCH: e }), [review(key, "reject")]);
    expect(rejected).toMatchObject({ status: "WARNING" });
    expect(rejected.raised[0]).toMatchObject({ review: "rejected", effective_severity: "WARNING" });
  });

  it("ignores a confirmation for another asset, flag, or document, and lets a rejection beat a confirmation", () => {
    const e = supplyCritical();
    const key = reviewKey(KEY, e);
    const other: Review[] = [
      { ...review(key, "confirm"), asset: "X:G" }, { ...review(key, "confirm"), flag: "STALE_ATTESTATION" }, review("0".repeat(64), "confirm"),
    ];
    expect(assetStatus(asset, evals({ SUPPLY_MISMATCH: e }), other).status).toBe("WARNING");
    expect(assetStatus(asset, evals({ SUPPLY_MISMATCH: e }), [review(key, "confirm"), review(key, "reject")]).raised[0].review).toBe("rejected");
  });

  it("does not need review for a WARNING supply mismatch", () => {
    const s = assetStatus(asset, evals({ SUPPLY_MISMATCH: raised("SUPPLY_MISMATCH", "WARNING", "x", "d", doc()) }), []);
    expect(s.raised[0]).toMatchObject({ review: "not_needed", review_key: null });
  });
});

describe("reviewKey", () => {
  it("is stable when on-chain values in the statement change, and changes with the document or quote", () => {
    const a = reviewKey(KEY, supplyCritical("Mismatch of 130.", doc()));
    expect(reviewKey(KEY, supplyCritical("Mismatch of 999.", doc()))).toBe(a);
    expect(reviewKey(KEY, supplyCritical("Mismatch of 130.", doc("q2")))).not.toBe(a);
    expect(reviewKey(KEY, supplyCritical("Mismatch of 130.", doc("q1", "sha-b")))).not.toBe(a);
    expect(reviewKey("OTHER:G", supplyCritical())).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not depend on the order of the documents", () => {
    const [x, y] = [doc("q1", "sha-a")[0], doc("q2", "sha-b")[0]];
    expect(reviewKey(KEY, supplyCritical("s", [x, y]))).toBe(reviewKey(KEY, supplyCritical("s", [y, x])));
  });

  it("ignores evidence that is not a document", () => {
    const withChain = [...doc(), { kind: "examination", ref: "data/examinations/2026-10-08.json#x" } as EvidenceRef];
    expect(reviewKey(KEY, supplyCritical("s", withChain))).toBe(reviewKey(KEY, supplyCritical("s", doc())));
  });
});

describe("evidence_hash", () => {
  it("is the same for the same inputs and changes when a flag changes", () => {
    const a = assetStatus(asset, evals(), []).evidence_hash;
    expect(assetStatus(asset, evals(), []).evidence_hash).toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    const raisedOne = assetStatus(asset, evals({ FLAG_CHANGE: raised("FLAG_CHANGE", "WARNING", "x", "d", []) }), []).evidence_hash;
    expect(raisedOne).not.toBe(a);
    expect(assetStatus(asset, evals({ FLAG_CHANGE: raised("FLAG_CHANGE", "WARNING", "x2", "d", []) }), []).evidence_hash).not.toBe(raisedOne);
  });

  it("changes when a review confirms a flag", () => {
    const e = supplyCritical();
    const pending = assetStatus(asset, evals({ SUPPLY_MISMATCH: e }), []);
    const confirmed = assetStatus(asset, evals({ SUPPLY_MISMATCH: e }), [review(reviewKey(KEY, e), "confirm")]);
    expect(confirmed.evidence_hash).not.toBe(pending.evidence_hash);
  });

  it("does not depend on the order the evaluations are given in", () => {
    expect(assetStatus(asset, [...evals()].reverse(), []).evidence_hash).toBe(assetStatus(asset, evals(), []).evidence_hash);
  });
});

describe("canonicalJson", () => {
  it("sorts keys recursively, keeps arrays in order, and drops undefined fields", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, 1, { z: 1, y: undefined }], c: null } })).toBe('{"a":{"c":null,"d":[3,1,{"z":1}]},"b":1}');
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
    expect(canonicalJson("x\"y")).toBe('"x\\"y"');
  });
});

describe("parseReviews", () => {
  const ok = { asset: KEY, flag: "SUPPLY_MISMATCH", review_key: "a".repeat(64), decision: "confirm", by: "op", at: "2026-10-08T00:00:00Z" };

  it("accepts valid entries", () => {
    expect(parseReviews([ok, { ...ok, decision: "reject", note: "typo in the filing" }])).toHaveLength(2);
    expect(parseReviews([])).toEqual([]);
  });

  it("throws on a bad entry instead of confirming silently", () => {
    expect(() => parseReviews({})).toThrow("data/review/flags.json is invalid");
    expect(() => parseReviews([{ ...ok, decision: "yes" }])).toThrow(/decision/);
    expect(() => parseReviews([{ ...ok, review_key: "short" }])).toThrow(/review_key/);
    expect(() => parseReviews([{ ...ok, flag: "NOPE" }])).toThrow(/flag/);
    expect(() => parseReviews([{ ...ok, extra: 1 }])).toThrow();
  });
});

describe("types", () => {
  it("builds results with the documented shape", () => {
    const r: RaisedEvaluation = raised("FLAG_CHANGE", "WARNING", "s", "d", [], { a: 1 });
    expect(r).toEqual({ flag: "FLAG_CHANGE", outcome: "raised", severity: "WARNING", statement: "s", as_of: "d", evidence: [], extra: { a: 1 } });
  });
});

describe("feed fields", () => {
  it("passes sac_contract_id, checked_at and issuer_change_seen_at through", () => {
    const s = assetStatus(asset, evals(), []);
    expect(s).toMatchObject({ sac_contract_id: SAC, checked_at: CTX.checked_at, issuer_change_seen_at: CTX.issuer_change_seen_at });
    const none = assetStatus(asset, evals(), [], { ...CTX, issuer_change_seen_at: null });
    expect(none.issuer_change_seen_at).toBeNull();
  });

  it("refuses to publish a status that the feed contract would reject", () => {
    const changed = evals({ SIGNER_CHANGE: raised("SIGNER_CHANGE", "WARNING", "x", "d", []) });
    expect(() => assetStatus(asset, changed, [], { ...CTX, issuer_change_seen_at: null })).toThrow(/issuer_change_seen_at is null/);
    expect(() => assetStatus(asset, evals(), [], { ...CTX, checked_at: null })).toThrow(/needs checked_at/);
    expect(() => assetStatus(asset, evals(), [], { ...CTX, issuer_change_seen_at: "2026-10-08T01:34:19.580Z" })).toThrow(/later than checked_at/);
    // an unpublished asset has no such constraints
    const unpublished = evals({ ISSUER_IDENTITY: notEvaluated("ISSUER_IDENTITY", "no check") });
    expect(assetStatus(asset, unpublished, [], { ...CTX, checked_at: null, issuer_change_seen_at: null })).toMatchObject({ status: null, checked_at: null });
  });
});

describe("assetEvidenceHash (spec 3.4)", () => {
  const file = { feed_schema: 1, rules_version: "flags-v2", inputs: INPUTS };
  const hashed = () => {
    const s = assetStatus(asset, evals({ FLAG_CHANGE: raised("FLAG_CHANGE", "WARNING", "x", "2026-10-08", []) }), []);
    return {
      file,
      a: { asset: s.asset, sac_contract_id: s.sac_contract_id, checked_at: s.checked_at, status: s.status, flags_bitmask: s.flags_bitmask, issuer_change_seen_at: s.issuer_change_seen_at, raised: s.raised, clear: s.clear, not_evaluated: s.not_evaluated },
      hash: s.evidence_hash,
    };
  };

  it("is the stored evidence_hash and is reproducible from the status file fields alone", () => {
    const { file: f, a, hash } = hashed();
    expect(assetEvidenceHash(f, a)).toBe(hash);
    // a round trip through JSON (what the file does) gives the same hash
    expect(assetEvidenceHash(JSON.parse(JSON.stringify(f)), JSON.parse(JSON.stringify(a)))).toBe(hash);
  });

  it("changes when any one hashed field changes", () => {
    const { file: f, a, hash } = hashed();
    const variants: [string, () => string][] = [
      ["feed_schema", () => assetEvidenceHash({ ...f, feed_schema: 2 }, a)],
      ["rules_version", () => assetEvidenceHash({ ...f, rules_version: "flags-v3" }, a)],
      ["inputs sha256", () => assetEvidenceHash({ ...f, inputs: { ...INPUTS, checks: { ...INPUTS.checks, sha256: "ab" } } }, a)],
      ["inputs path", () => assetEvidenceHash({ ...f, inputs: { ...INPUTS, claims: { ...INPUTS.claims, path: "data/claims/other.json" } } }, a)],
      ["asset", () => assetEvidenceHash(f, { ...a, asset: "BB2:G" })],
      ["sac_contract_id", () => assetEvidenceHash(f, { ...a, sac_contract_id: "CAZGJD4BG6RLFQIAGPDPSX3IR73CBSVDEIBUDQGDZ3RCGGSOYSVBDSM7" })],
      ["checked_at", () => assetEvidenceHash(f, { ...a, checked_at: "2026-10-08T01:34:19.580Z" })],
      ["status", () => assetEvidenceHash(f, { ...a, status: "CRITICAL" })],
      ["flags_bitmask", () => assetEvidenceHash(f, { ...a, flags_bitmask: a.flags_bitmask | 1 })],
      ["issuer_change_seen_at", () => assetEvidenceHash(f, { ...a, issuer_change_seen_at: null })],
      ["raised", () => assetEvidenceHash(f, { ...a, raised: [] })],
      ["clear", () => assetEvidenceHash(f, { ...a, clear: a.clear.slice(1) })],
      ["not_evaluated", () => assetEvidenceHash(f, { ...a, not_evaluated: [notEvaluated("LARGE_MINT_BURN", "x")] })],
    ];
    for (const [name, fn] of variants) expect(fn(), name).not.toBe(hash);
    expect(new Set(variants.map(([, fn]) => fn())).size).toBe(variants.length);
  });

  it("does not depend on the order of the evaluations, nor on key order in the inputs", () => {
    const a = assetStatus(asset, [...evals()].reverse(), []).evidence_hash;
    expect(a).toBe(assetStatus(asset, evals(), []).evidence_hash);
    const reordered = { claims: INPUTS.claims, checks: { checked_at: INPUTS.checks.checked_at, sha256: INPUTS.checks.sha256, path: INPUTS.checks.path } };
    expect(assetStatus(asset, evals(), [], { ...CTX, inputs: reordered }).evidence_hash).toBe(a);
  });

  it("matches a fixed golden value, so the formula can't drift silently", () => {
    const golden = assetEvidenceHash(
      { feed_schema: 1, rules_version: "flags-v2", inputs: { checks: { path: "data/checks/2026-10-08.json", sha256: "aa" } } },
      {
        asset: `BB1:${ISSUER}`, sac_contract_id: SAC, checked_at: "2026-10-08T01:34:19.579Z", status: "WARNING", flags_bitmask: 8,
        issuer_change_seen_at: "2026-10-08T01:34:19.579Z",
        raised: [{ flag: "FLAG_CHANGE", outcome: "raised", severity: "WARNING", statement: "s", as_of: "2026-10-08", evidence: [], document_derived: false, review: "not_needed", review_key: null, effective_severity: "WARNING" }],
        clear: [], not_evaluated: [],
      },
    );
    // computed with an independent canonicalizer (sorted keys, no whitespace) over the object of spec 3.4
    expect(golden).toBe("fddd63c85d576f5446cc15d3d797a6c3ad0146bb328e4d3ba421b0643649b6aa");
  });
});
