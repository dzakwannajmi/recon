import { describe, expect, it } from "vitest";
import { check, reference } from "./fixtures";
import { excessShare, flagSupplyMismatch } from "./supply";

const filed = (supply: string, diff: string, over = {}) =>
  check({
    check: "supply_vs_filed_shares", reference: reference({ kind: "filing", label: "SEC N-MFP3 filed 2026-09-04", quote: "<n>100</n>", snapshot_sha256: "sha-sec" }),
    ratio: reference({ kind: "claim", value: 1, quote: "1 token = 1 share", snapshot_sha256: "sha-toml" }),
    onchain: { supply, as_of: "2026-10-08T00:00:00.000Z" }, threshold_tokens: "100.0000000", difference: diff, statement: `Mismatch ${supply}.`, ...over,
  });

describe("flagSupplyMismatch", () => {
  it("is not evaluated when nothing is comparable, quoting the reason", () => {
    expect(flagSupplyMismatch([])).toMatchObject({ outcome: "not_evaluated", reason: "No filed shares or maximum issuance to compare with" });
    const nc = filed("1", "0", { status: "not_comparable", statement: "Not comparable: no ratio." });
    expect(flagSupplyMismatch([nc])).toMatchObject({ outcome: "not_evaluated", reason: "Not comparable: no ratio." });
    // toml checks are the other flag's business
    expect(flagSupplyMismatch([check()])).toMatchObject({ outcome: "not_evaluated" });
  });

  it("is clear when a check is consistent", () => {
    const e = flagSupplyMismatch([filed("90", "-10", { status: "consistent", statement: "Fine." }), filed("1", "0", { status: "not_comparable", statement: "Nope." })]);
    expect(e).toMatchObject({ outcome: "clear", reason: "Fine.", as_of: "2026-10-08" });
  });

  it("is WARNING at exactly 25% over and CRITICAL just above", () => {
    expect(flagSupplyMismatch([filed("125", "25.0000000")])).toMatchObject({ outcome: "raised", severity: "WARNING", extra: { excess_percent: 25 } });
    expect(flagSupplyMismatch([filed("125.01", "25.0100000")])).toMatchObject({ outcome: "raised", severity: "CRITICAL", extra: { excess_percent: 25.01 } });
  });

  it("keeps the filing, the ratio, and the quotes as evidence", () => {
    const e = flagSupplyMismatch([filed("130", "30.0000000")]);
    if (e.outcome !== "raised") throw new Error("expected raised");
    expect(e.evidence.map((r) => r.kind)).toEqual(["examination", "source_fact", "claim"]);
    expect(e.evidence[1]).toMatchObject({ quote: "<n>100</n>", snapshot_sha256: "sha-sec", source_url: expect.stringContaining("bitbondsto.com") });
  });

  it("joins several mismatches, reports the largest excess, and is CRITICAL if any is", () => {
    const e = flagSupplyMismatch([filed("110", "10.0000000", { statement: "A." }), filed("150", "50.0000000", { check: "supply_vs_max_issuance", statement: "B." })]);
    expect(e).toMatchObject({ severity: "CRITICAL", statement: "A. B.", extra: { excess_percent: 50 } });
  });

  it("never invents CRITICAL when the excess can't be computed", () => {
    const e = flagSupplyMismatch([filed("999", "899", { threshold_tokens: null })]);
    expect(e).toMatchObject({ outcome: "raised", severity: "WARNING" });
    expect(e.outcome === "raised" && e.extra).toBeUndefined();
    expect(excessShare({ difference: "5", threshold_tokens: "0" })).toBeNull();
    expect(excessShare({ difference: "5", threshold_tokens: "100" })).toBe(0.05);
  });
});
