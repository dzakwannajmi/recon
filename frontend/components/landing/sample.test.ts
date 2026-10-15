import { describe, expect, it } from "vitest";
import type { LoadedAsset } from "@/lib/factsheet/load";
import { pickSample } from "./sample";

const flag = (quote?: string) =>
  ({
    flag: "TOML_INCONSISTENT",
    outcome: "raised",
    severity: "WARNING",
    effective_severity: "WARNING",
    review: "not_needed",
    statement: "Mismatch between a and b.",
    as_of: "2026-10-15",
    evidence: [{ kind: "chain_check", ref: "x" }, ...(quote ? [{ kind: "source_fact", ref: "y", quote }] : [])],
  }) as unknown as LoadedAsset["raised"][number];

const asset = (code: string, raised: LoadedAsset["raised"]) => ({ asset_code: code, raised }) as unknown as LoadedAsset;

describe("pickSample", () => {
  it("prefers BB1 when it has a flag with a quote", () => {
    const s = pickSample({ assets: [asset("AAA", [flag("q1")]), asset("BB1", [flag("q2")])] });
    expect(s?.asset.asset_code).toBe("BB1");
    expect(s?.quote.quote).toBe("q2");
  });
  it("falls back to the first asset with a quoted flag", () => {
    const s = pickSample({ assets: [asset("AAA", []), asset("BBB", [flag()]), asset("CCC", [flag("q3")])] });
    expect(s?.asset.asset_code).toBe("CCC");
  });
  it("skips BB1 when its flag has no quote", () => {
    const s = pickSample({ assets: [asset("BB1", [flag()]), asset("DDD", [flag("q4")])] });
    expect(s?.asset.asset_code).toBe("DDD");
  });
  it("returns null when nothing fits", () => {
    expect(pickSample({ assets: [asset("AAA", [flag()])] })).toBeNull();
    expect(pickSample({ assets: [] })).toBeNull();
  });
});
