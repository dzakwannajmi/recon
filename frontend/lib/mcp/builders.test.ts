/**
 * The pure builders (spec 4.3, 4.4) on edge cases the committed data does not have.
 */
import { describe, expect, it } from "vitest";
import type { LoadedAsset } from "../factsheet/load";
import { COPY } from "../factsheet/copy";
import { realAsset } from "../gateway/testkit";
import { buildFactSheet } from "./factsheet";
import { buildFlagList } from "./flags";
import { factSheetOutputSchema, flagListOutputSchema } from "./schemas";

const base = realAsset("USTRY");
const sheet = (asset: LoadedAsset, over: { codeIsUnique?: boolean; deployment?: { contract_id: string } | null } = {}) =>
  buildFactSheet({ asset, row: base.row, codeIsUnique: over.codeIsUnique ?? true, status: base.loaded, deployment: over.deployment === undefined ? { contract_id: "CXYZ" } : over.deployment });

const withEvidence = (n: number, quote: string, url: string | null): LoadedAsset => {
  const [first, ...rest] = base.asset.raised;
  const evidence = Array.from({ length: n }, (_, i) => ({ kind: "claim" as const, ref: `r${i}`, source_url: url, snapshot_sha256: "ab".repeat(32), quote, where: "p1" }));
  return { ...base.asset, raised: [{ ...first, evidence }, ...rest] };
};

describe("buildFactSheet", () => {
  it("cuts evidence at 10 per flag and quotes at 1,000 code points without splitting a pair", () => {
    const long = "\u{1F600}".repeat(1500);
    const out = sheet(withEvidence(15, long, "https://example.com/a.pdf"));
    const ev = out.flags.raised[0].evidence;
    expect(ev).toHaveLength(10);
    expect(Array.from(ev[0].quote as string)).toHaveLength(1000);
    expect(ev[0].quote_truncated).toBe(true);
    expect(sheet(withEvidence(1, "short", null)).flags.raised[0].evidence[0]).toMatchObject({ quote: "short", quote_truncated: false });
    factSheetOutputSchema.parse(out);
  });

  it("source_url is null unless it is plain http(s)", () => {
    for (const url of ["javascript:alert(1)", "https://user:pw@evil.example/", "not a url", "ftp://x.example/f"]) {
      expect(sheet(withEvidence(1, "q", url)).flags.raised[0].evidence[0].source_url, url).toBeNull();
    }
    expect(sheet(withEvidence(1, "q", "https://example.com/a")).flags.raised[0].evidence[0].source_url).toBe("https://example.com/a");
  });

  it("review_note is copy for pending, confirmed, and rejected; null otherwise", () => {
    const [first, ...rest] = base.asset.raised;
    for (const review of ["not_needed", "pending", "confirmed", "rejected"] as const) {
      const out = sheet({ ...base.asset, raised: [{ ...first, review }, ...rest] });
      expect(out.flags.raised[0].review_note).toBe(review === "not_needed" ? null : COPY.en.review[review]);
    }
  });

  it("links.fact_sheet is null when the code is not unique; feed.contract_id is null without a deployment", () => {
    expect(sheet(base.asset, { codeIsUnique: false }).links.fact_sheet).toBeNull();
    expect(sheet(base.asset, { deployment: null }).feed?.contract_id).toBeNull();
  });

  it("statements and reasons are copied byte for byte", () => {
    const out = sheet(base.asset);
    expect(out.flags.raised.map((f) => f.statement)).toEqual(base.asset.raised.map((f) => f.statement));
    expect(out.flags.clear.map((f) => f.reason)).toEqual(base.asset.clear.map((f) => f.reason));
    expect(out.flags.not_evaluated.map((f) => f.reason)).toEqual(base.asset.not_evaluated.map((f) => f.reason));
  });
});

describe("buildFlagList", () => {
  it("filters by flag and severity; counts ignore the filters; status_counts is the file's summary", () => {
    const all = buildFlagList({ status: base.loaded, filters: {} });
    const one = buildFlagList({ status: base.loaded, filters: { flag: "NO_PUBLIC_DOCS", severity: "WARNING" } });
    expect(one.flags).toEqual(all.flags);
    expect(one.raised.items.every((i) => i.flag === "NO_PUBLIC_DOCS" && i.effective_severity === "WARNING")).toBe(true);
    expect(one.status_counts).toEqual(base.loaded.status.summary);
    flagListOutputSchema.parse(all);
  });

  it("a pending critical flag counts as WARNING for the severity filter", () => {
    const [first, ...rest] = base.asset.raised;
    const asset: LoadedAsset = { ...base.asset, raised: [{ ...first, severity: "CRITICAL", effective_severity: "WARNING", review: "pending" }, ...rest] };
    const status = { ...base.loaded, status: { ...base.loaded.status, assets: base.loaded.status.assets.map((a) => (a.asset === asset.asset ? asset : a)) } };
    const crit = buildFlagList({ status, filters: { severity: "CRITICAL" } });
    expect(crit.raised.items.some((i) => i.asset_code === "USTRY")).toBe(false);
    const warn = buildFlagList({ status, filters: { severity: "WARNING" } });
    expect(warn.raised.items.find((i) => i.asset_code === "USTRY" && i.flag === first.flag)).toMatchObject({ severity: "CRITICAL", effective_severity: "WARNING", review: "pending" });
  });
});
