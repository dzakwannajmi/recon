import { describe, expect, it } from "vitest";
import { describeDiff, diffStatus } from "./diff";

const a = (code: string, status: string | null, bits: number, flags: string[]) => ({ asset: `${code}:G`, asset_code: code, status, flags_bitmask: bits, raised: flags.map((flag) => ({ flag })) });

describe("D1: status diff", () => {
  const before = { assets: [a("AAA", "OK", 0, []), a("BBB", "WARNING", 1 << 7, ["NO_PUBLIC_DOCS"]), a("CCC", "WARNING", 1 << 5, ["LARGE_MINT_BURN"]), a("DDD", "OK", 0, [])] };
  const after = { assets: [a("AAA", "OK", 0, []), a("BBB", "WARNING", 1 << 7, ["NO_PUBLIC_DOCS"]), a("CCC", "OK", 0, []), a("DDD", "WARNING", 1 << 5, ["LARGE_MINT_BURN"]), a("EEE", "OK", 0, [])] };

  it("lists status and bitmask changes, newly raised and cleared flags, by asset code", () => {
    const d = diffStatus(before, after, "data/status/2026-10-15.json");
    expect(d.against).toBe("data/status/2026-10-15.json");
    expect(d.items).toEqual([
      { asset: "CCC", status_from: "WARNING", status_to: "OK", bitmask_from: 32, bitmask_to: 0, raised: [], cleared: ["LARGE_MINT_BURN"] },
      { asset: "DDD", status_from: "OK", status_to: "WARNING", bitmask_from: 0, bitmask_to: 32, raised: ["LARGE_MINT_BURN"], cleared: [] },
      { asset: "EEE", status_from: null, status_to: "OK", bitmask_from: 0, bitmask_to: 0, raised: [], cleared: [] },
    ]);
  });

  it("no previous status: every published asset is new; an unpublished one without flags is skipped", () => {
    const d = diffStatus(null, { assets: [a("AAA", "OK", 0, []), a("ZZZ", null, 0, [])] }, null);
    expect(d.items.map((i) => i.asset)).toEqual(["AAA"]);
  });

  it("the text carries no judgment words", () => {
    const lines = describeDiff(diffStatus(before, after, "x")).concat(describeDiff({ against: null, items: [] }));
    expect(lines.join("\n")).toContain("DDD: OK -> WARNING; flags 0 -> 32; raised LARGE_MINT_BURN");
    expect(lines.join("\n")).not.toMatch(/unsafe|risky|fraud|scam|suspicious|rating|score|grade|price/i);
    expect(describeDiff({ against: "f", items: [] })).toEqual(["no status change against f"]);
  });
});
