import { describe, expect, it } from "vitest";
import { MAX_PROPOSALS_BYTES, validateProposals, type ProposalsExpected } from "./proposals";

const ID = "0123456789abcdef";
const NOW = "2026-10-08T12:00:00.000Z";
const expected: ProposalsExpected = { doc_key: "d|BENJI:GA", codes: ["BENJI"], sourceClass: "issuer" };
const claim = { field: "custodian", asset_code: "ISSUER", value_text: "UMB Bank", unit: null, as_of_text: null, quote: "UMB Bank holds the assets in custody.", page: null };
const file = (over: Record<string, unknown> = {}) => ({
  id: ID, doc_key: "d|BENJI:GA", text_sha256: "a".repeat(64), proposed_by: "operator via Claude Code (review-reader, sonnet)", reviewed_at: "2026-10-08T10:00:00.000Z", claims: [claim], ...over,
});
const check = (obj: unknown, exp: ProposalsExpected | null = expected, stem = ID, extra: { bytes?: number; now?: string } = {}) =>
  validateProposals({ stem, raw: typeof obj === "string" ? obj : JSON.stringify(obj), expected: exp, now: NOW, ...extra });
const reason = (r: ReturnType<typeof check>) => (r.ok ? "" : r.reason);

describe("validateProposals", () => {
  it("accepts a valid file", () => {
    expect(check(file()).ok).toBe(true);
  });

  it("refuses unknown keys at every level", () => {
    expect(check(file({ extra: 1 })).ok).toBe(false);
    expect(check(file({ claims: [{ ...claim, status: "OK" }] })).ok).toBe(false);
  });

  it("refuses an id that differs from the file name or the queue entry, and a different doc_key", () => {
    expect(reason(check(file(), expected, "fedcba9876543210"))).toMatch(/file name/);
    expect(reason(check(file({ id: "fedcba9876543210" })))).toMatch(/file name/);
    expect(reason(check(file({ doc_key: "other" })))).toMatch(/doc_key/);
    expect(reason(check(file(), null))).toBe("not_in_queue");
  });

  it("needs a note when claims are empty", () => {
    expect(check(file({ claims: [] })).ok).toBe(false);
    expect(check(file({ claims: [], note: "  " })).ok).toBe(false);
    expect(check(file({ claims: [], note: "Read the whole document: no v1 field is stated." })).ok).toBe(true);
  });

  it("refuses bad claim values, asset codes outside the entry, and bad metadata", () => {
    expect(check(file({ claims: [{ ...claim, field: "status" }] })).ok).toBe(false);
    expect(check(file({ claims: [{ ...claim, asset_code: "OTHER" }] })).ok).toBe(false);
    expect(check(file({ proposed_by: "<script>" })).ok).toBe(false);
    expect(check(file({ reviewed_at: "yesterday" })).ok).toBe(false);
    expect(check("{not json").ok).toBe(false);
  });

  it.each([
    ["stellar_secret_seed", "S" + "A".repeat(55)],
    ["api_key_sk", "sk-" + "a1".repeat(10)],
    ["api_key_google", "AIza" + "x".repeat(35)],
    ["private_key_block", "-----BEGIN PRIVATE KEY-----"],
  ])("refuses a file with a %s and never logs the match", (name, secret) => {
    const r = check(file({ note: `see ${secret} here` }));
    expect(r.ok).toBe(false);
    expect(reason(r)).toContain(name);
    expect(reason(r)).toContain("do not commit");
    expect(reason(r)).not.toContain(secret);
    // Also when the file is not valid JSON, and when the secret is JSON-escaped.
    expect(reason(check(`{ ${secret}`))).toContain(name);
    expect(reason(check(JSON.stringify(file({ note: secret })).replace(/A/g, "\\u0041")))).not.toContain(secret);
  });

  it("finds a secret hidden behind JSON escapes", () => {
    const raw = JSON.stringify(file({ note: "x" })).replace('"x"', `"\\u0053${"A".repeat(55)}"`);
    expect(raw).toContain("\\u0053");
    expect(reason(check(raw))).toContain("stellar_secret_seed");
  });

  it("refuses a file over 64 KB, measured in raw bytes", () => {
    expect(reason(check(file({ note: "x".repeat(MAX_PROPOSALS_BYTES) })))).toMatch(/larger than 64 KB/);
    // The same text is small once re-encoded; the raw size passed by the reader decides.
    expect(reason(check(file(), expected, ID, { bytes: MAX_PROPOSALS_BYTES + 1 }))).toMatch(/larger than 64 KB/);
    expect(check(file(), expected, ID, { bytes: MAX_PROPOSALS_BYTES }).ok).toBe(true);
  });

  it("refuses a reviewed_at later than now", () => {
    expect(reason(check(file({ reviewed_at: "2026-10-08T12:00:00.001Z" })))).toMatch(/future/);
    expect(check(file({ reviewed_at: NOW })).ok).toBe(true);
  });

  it("refuses a regulatory filing", () => {
    expect(reason(check(file(), { ...expected, sourceClass: "regulatory_filing" }))).toMatch(/not reviewable/);
    expect(check(file(), { ...expected, sourceClass: "issuer_toml" }).ok).toBe(true);
  });
});
