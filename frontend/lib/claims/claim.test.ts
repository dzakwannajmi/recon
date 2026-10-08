import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { SnapshotRecord } from "../documents/store";
import { buildClaims } from "./claim";
import type { ProposedClaim } from "./fields";

const record = {
  sha256: "s".repeat(64),
  url: "https://cdn.figure.com/docs/prospectus.pdf",
  finalUrl: "https://cdn.figure.com/docs/prospectus.pdf",
  sourceClass: "issuer",
  assets: ["YLDS:GAC7", "OTHER:GXYZ"],
  text: { kind: "pdf", chars: 10, pages: 1, sha256: "t", extractor: "x" },
} as unknown as SnapshotRecord;

const p = (overrides: Partial<ProposedClaim>): ProposedClaim => ({
  field: "custodian", asset_code: "ISSUER", value_text: "UMB Bank", unit: null, as_of_text: null, quote: "UMB Bank holds the assets in custody.", page: 1, ...overrides,
});
const ok = { ok: true as const, result: { value: "UMB Bank", value_text: "UMB Bank", unit: null, as_of: null, page: 3 } };

const build = (proposals: ProposedClaim[], officialDomains = ["ylds.com"], fieldSource: "llm" | "operator-reviewed" = "llm") =>
  buildClaims({ record, docKey: "d", officialDomains, proposals, verify: () => ok, model: "m", promptVersion: "v", now: "2026-10-07T00:00:00.000Z", fieldSource });

describe("buildClaims", () => {
  it("keys issuer-level claims by the pinned official domain, never the document host", () => {
    const { claims } = build([p({})]);
    expect(claims[0].asset).toBe("ISSUER:ylds.com");
    expect(claims[0].field_source).toBe("llm");
    expect(claims[0].page).toBe(3);
  });

  it("drops issuer-level claims when the document's assets have different official domains", () => {
    expect(build([p({})], ["ylds.com", "figure.com"]).dropped[0].reason).toBe("issuer_ambiguous");
  });

  it("maps asset codes to the document's own asset keys", () => {
    expect(build([p({ asset_code: "YLDS" })]).claims[0].asset).toBe("YLDS:GAC7");
  });

  it("stores a repeated fact once and logs claims over the cap", () => {
    expect(build([p({}), p({ quote: "UMB Bank is the custodian of the assets." })]).claims).toHaveLength(1);
    const many = Array.from({ length: 27 }, (_, i) => p({ value_text: `Bank ${i}` }));
    const { dropped } = buildClaims({
      record, docKey: "d", officialDomains: ["ylds.com"], proposals: many, model: "m", promptVersion: "v", now: "n", fieldSource: "llm",
      verify: (c) => ({ ok: true, result: { ...ok.result, value: c.value_text } }),
    });
    expect(dropped.filter((d) => d.reason === "over_cap")).toHaveLength(2);
  });

  it("keeps LLM claim ids stable and gives operator-reviewed claims their own ids", () => {
    const llm = build([p({})]).claims[0];
    const op = build([p({})], ["ylds.com"], "operator-reviewed").claims[0];
    // Pinned: the id of an LLM claim must never change (existing data/claims ids).
    expect(llm.id).toBe(createHash("sha256").update(["d", "ISSUER:ylds.com", "custodian", "UMB Bank holds the assets in custody.", "UMB Bank"].join("|")).digest("hex").slice(0, 16));
    expect(op.field_source).toBe("operator-reviewed");
    expect(op.id).not.toBe(llm.id);
  });
});
