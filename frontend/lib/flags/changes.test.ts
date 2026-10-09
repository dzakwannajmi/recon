import { describe, expect, it, vi } from "vitest";
import type { AssetFacts } from "../chain/asset";
import { CHANGE_HOLD_DAYS, flagFlagChange, flagSignerChange, issuerChangeSeenAt, type ChecksSeries } from "./changes";
import { facts, identity, row } from "./fixtures";
import type { Evaluation } from "./types";

const A = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const B = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const C = "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";

/** The row of one check on a given day (clock 01:00 UTC), with its own file name. */
const at = (d: string, over: Partial<AssetFacts> = {}) =>
  row({ file: `data/checks/${d}.json`, identity: identity({ checkedAt: `${d}T01:00:00.000Z` }), facts: facts({ checkedAt: `${d}T01:00:00.000Z`, ...over }) });

const OPEN = { auth_required: true, auth_revocable: false, auth_immutable: false, auth_clawback_enabled: false };
const NEXT = { auth_required: true, auth_revocable: true, auth_immutable: false, auth_clawback_enabled: true };
const prev = (over: Partial<AssetFacts> = {}) => at("2026-10-06", over);
const cur = (over: Partial<AssetFacts> = {}) => at("2026-10-08", over);
const text = (e: Evaluation) => (e.outcome === "raised" ? e.statement : e.outcome === "clear" ? e.reason : e.reason);

/** Checks on 2026-10-06 (OPEN flags), 2026-10-08 (NEXT flags, the change), then the same NEXT flags on the given days. */
const afterChange = (...days: string[]): ChecksSeries => [prev({ flags: OPEN }), cur({ flags: NEXT }), ...days.map((d) => at(d, { flags: NEXT }))];

describe("flagFlagChange: what is not evaluated", () => {
  it("is not evaluated without a current row, a previous usable row, or with a failed current row", () => {
    expect(flagFlagChange([])).toMatchObject({ outcome: "not_evaluated", reason: expect.stringContaining("current checks file") });
    expect(flagFlagChange([prev(), undefined])).toMatchObject({ outcome: "not_evaluated", reason: "No chain check for this asset in the current checks file" });
    expect(flagFlagChange([cur()])).toMatchObject({ outcome: "not_evaluated", reason: "No previous chain check for this asset to compare with" });
    expect(flagFlagChange([undefined, cur()])).toMatchObject({ outcome: "not_evaluated", reason: expect.stringContaining("No previous") });
    expect(flagFlagChange([prev(), row({ identity: undefined, facts: undefined, error: "x" })])).toMatchObject({ outcome: "not_evaluated", reason: "The current chain check failed or has no on-chain facts" });
    expect(flagFlagChange([prev(), cur({ flags: undefined })])).toMatchObject({ outcome: "not_evaluated", reason: "The current chain check has no authorization flags" });
  });

  it("never falls back to an older row as the current one", () => {
    // Three good rows, then the asset is missing from the current file.
    expect(flagFlagChange([prev(), cur(), undefined]).outcome).toBe("not_evaluated");
    expect(flagFlagChange([prev(), cur(), row({ error: "timeout", facts: undefined })]).outcome).toBe("not_evaluated");
  });

  it("skips a previous row that failed or lacks flags and compares the next one", () => {
    expect(flagFlagChange([prev({ flags: undefined }), cur()])).toMatchObject({ outcome: "not_evaluated", reason: expect.stringContaining("No previous") });
    expect(flagFlagChange([row({ identity: undefined, facts: undefined, error: "x" }), cur()]).outcome).toBe("not_evaluated");
  });

  it("is not evaluated when the current check time is not a real date", () => {
    expect(flagFlagChange([prev(), cur({ checkedAt: "garbage" })])).toMatchObject({ outcome: "not_evaluated", reason: "The current chain check has no valid check time" });
  });
});

describe("flagFlagChange: no change", () => {
  it("is clear when the four flags are the same in all checks, with the first and current checks as evidence", () => {
    const e = flagFlagChange([prev(), cur()]);
    expect(e).toMatchObject({ outcome: "clear", as_of: "2026-10-08", reason: "The issuer authorization flags are the same in all 2 checks from 2026-10-06 to 2026-10-08." });
    expect(e.outcome === "clear" && e.evidence.map((r) => r.ref)).toEqual([expect.stringContaining("2026-10-06"), expect.stringContaining("2026-10-08")]);
    expect(text(flagFlagChange([prev(), at("2026-10-07"), cur()]))).toContain("in all 3 checks from 2026-10-06 to 2026-10-08");
  });
});

describe("flagFlagChange: hold window (S1)", () => {
  it("lists every change in key order and holds the flag through seen day + 7", () => {
    const e = flagFlagChange(afterChange());
    expect(e).toMatchObject({ outcome: "raised", severity: "WARNING", as_of: "2026-10-08" });
    expect(text(e)).toBe(
      "Issuer authorization flags changed between checks on 2026-10-06 and 2026-10-08: auth_revocable false → true, auth_clawback_enabled false → true. Held through 2026-10-15 (7 days after the change was first seen).",
    );
    expect(e.outcome === "raised" && e.evidence.map((r) => r.ref)).toEqual([expect.stringContaining("2026-10-06"), expect.stringContaining("2026-10-08")]);
  });

  it("is raised on day D, D+1 and D+7, and clear at D+8 with the last change named", () => {
    expect(CHANGE_HOLD_DAYS).toBe(7);
    for (const d of ["2026-10-09", "2026-10-15"]) {
      const e = flagFlagChange(afterChange(d));
      expect(e, d).toMatchObject({ outcome: "raised", as_of: d });
      expect(text(e)).toContain("Held through 2026-10-15");
    }
    const held = flagFlagChange(afterChange("2026-10-09", "2026-10-15"));
    // the evidence now also names the current check
    expect(held.outcome === "raised" && held.evidence.map((r) => r.ref)).toEqual([expect.stringContaining("2026-10-06"), expect.stringContaining("2026-10-08"), expect.stringContaining("2026-10-15")]);

    const cleared = flagFlagChange(afterChange("2026-10-15", "2026-10-16"));
    expect(cleared).toMatchObject({ outcome: "clear", as_of: "2026-10-16" });
    expect(text(cleared)).toBe(
      "No change in the issuer authorization flags in the 7 days before the check on 2026-10-16; the last change was seen between checks on 2026-10-06 and 2026-10-08.",
    );
    // still clear later on
    expect(flagFlagChange(afterChange("2026-10-16", "2026-11-30")).outcome).toBe("clear");
  });

  it("uses the check time, not the run time: a system clock far in the future changes nothing", () => {
    const series = afterChange("2026-10-15"); // change seen 2026-10-08, current check 2026-10-15
    const before = flagFlagChange(series);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2027-06-01"));
      const after = flagFlagChange(series);
      expect(after.outcome).toBe("raised");
      expect(after).toEqual(before);
      expect(flagSignerChange(afterChange("2026-10-15")).outcome).toBe("clear");
    } finally {
      vi.useRealTimers();
    }
  });

  it("treats a time that is not a full ISO time as unusable", () => {
    const junk = "2026-10-08Tjunk";
    expect(flagFlagChange([prev({ flags: OPEN }), cur({ flags: NEXT, checkedAt: junk })])).toMatchObject({ outcome: "not_evaluated", reason: "The current chain check has no valid check time" });
    // a bad middle row is skipped, like a failed one
    expect(flagFlagChange([prev({ flags: OPEN }), at("2026-10-07", { flags: NEXT, checkedAt: junk }), cur({ flags: OPEN })]).outcome).toBe("clear");
    expect(issuerChangeSeenAt([prev({ flags: OPEN }), cur({ flags: NEXT, checkedAt: junk })])).toBeNull();
    expect(issuerChangeSeenAt([prev({ flags: OPEN }), cur({ flags: NEXT, checkedAt: "2026-10-08" }), at("2026-10-09", { flags: NEXT })])).toBe("2026-10-09T01:00:00.000Z");
  });

  it("counts calendar days in UTC, not hours", () => {
    const late = (d: string, over: Partial<AssetFacts>) => row({ file: `data/checks/${d}.json`, facts: facts({ checkedAt: `${d}T23:59:59.000Z`, ...over }) });
    const early = (d: string, over: Partial<AssetFacts>) => row({ file: `data/checks/${d}.json`, facts: facts({ checkedAt: `${d}T00:00:01.000Z`, ...over }) });
    // seen late on the 8th, checked early on the 15th (6 days and 1 minute later): held; early on the 16th: clear
    expect(flagFlagChange([late("2026-10-06", { flags: OPEN }), late("2026-10-08", { flags: NEXT }), early("2026-10-15", { flags: NEXT })]).outcome).toBe("raised");
    expect(flagFlagChange([late("2026-10-06", { flags: OPEN }), late("2026-10-08", { flags: NEXT }), early("2026-10-16", { flags: NEXT })]).outcome).toBe("clear");
  });
});

describe("flagFlagChange: reverts and gaps (S2, S3)", () => {
  it("counts a revert as two events; the latest counts, with the number of changes in the window", () => {
    const series: ChecksSeries = [at("2026-10-06", { flags: OPEN }), at("2026-10-08", { flags: NEXT }), at("2026-10-10", { flags: OPEN })];
    const e = flagFlagChange(series);
    expect(e).toMatchObject({ outcome: "raised", as_of: "2026-10-10" });
    expect(text(e)).toBe(
      "Issuer authorization flags changed between checks on 2026-10-08 and 2026-10-10: auth_revocable true → false, auth_clawback_enabled true → false. Held through 2026-10-17 (7 days after the change was first seen). 2 changes in the last 7 days.",
    );
    // 2026-10-16: the first change (seen 10-08) is 8 days old and leaves the window; the second (10-10) is still held
    const later = flagFlagChange([...series, at("2026-10-16", { flags: OPEN })]);
    expect(later.outcome).toBe("raised");
    expect(text(later)).not.toContain("changes in the last");
    // 2026-10-18: both are out of the window
    expect(flagFlagChange([...series, at("2026-10-18", { flags: OPEN })]).outcome).toBe("clear");
  });

  it("does not count a change older than the window", () => {
    const series: ChecksSeries = [at("2026-10-01", { flags: OPEN }), at("2026-10-02", { flags: NEXT }), at("2026-10-10", { flags: OPEN })];
    const e = flagFlagChange(series);
    expect(e.outcome).toBe("raised");
    expect(text(e)).not.toContain("changes in the last");
  });

  it("skips a failed middle row and compares its neighbours (A ok, B error, C ok)", () => {
    const failed = row({ file: "data/checks/2026-10-07.json", identity: undefined, facts: undefined, error: "timeout" });
    const e = flagFlagChange([prev({ flags: OPEN }), failed, cur({ flags: NEXT })]);
    expect(e).toMatchObject({ outcome: "raised", as_of: "2026-10-08" });
    expect(text(e)).toContain("between checks on 2026-10-06 and 2026-10-08");
    // a middle row without flags is skipped the same way
    expect(flagFlagChange([prev({ flags: OPEN }), at("2026-10-07", { flags: undefined }), cur({ flags: NEXT })]).outcome).toBe("raised");
  });

  it("is not evaluated with fewer than 2 usable rows", () => {
    const failed = row({ identity: undefined, facts: undefined, error: "x" });
    expect(flagFlagChange([failed, failed, cur()]).outcome).toBe("not_evaluated");
    expect(flagFlagChange([cur()]).outcome).toBe("not_evaluated");
  });
});

describe("flagSignerChange", () => {
  const two = [{ key: A, weight: 1 }, { key: B, weight: 3 }];

  it("is not evaluated when signers or thresholds are missing", () => {
    expect(flagSignerChange([prev({ issuerSigners: undefined }), cur()])).toMatchObject({ outcome: "not_evaluated", reason: "No previous chain check for this asset to compare with" });
    expect(flagSignerChange([prev(), cur({ issuerThresholds: undefined })])).toMatchObject({ outcome: "not_evaluated", reason: "The current chain check has no signers or thresholds" });
    expect(flagSignerChange([]).outcome).toBe("not_evaluated");
    expect(flagSignerChange([prev(), undefined]).outcome).toBe("not_evaluated");
  });

  it("treats a reordered signer list as no change", () => {
    const e = flagSignerChange([prev({ issuerSigners: two }), cur({ issuerSigners: [...two].reverse() })]);
    expect(e).toMatchObject({ outcome: "clear", reason: "The issuer signers and thresholds are the same in all 2 checks from 2026-10-06 to 2026-10-08." });
  });

  it("reports added and removed signers, weight changes, and thresholds, abbreviating keys", () => {
    const e = flagSignerChange([
      prev({ issuerSigners: two, issuerThresholds: { low: 0, medium: 0, high: 6 } }),
      cur({ issuerSigners: [{ key: A, weight: 2 }, { key: C, weight: 1 }], issuerThresholds: { low: 0, medium: 1, high: 5 } }),
    ]);
    expect(e.outcome === "raised" && e.statement).toBe(
      "Issuer signers or thresholds changed between checks on 2026-10-06 and 2026-10-08: added GCCC…CCCC(weight 1); removed GBBB…BBBB(weight 3); GAAA…AAAA weight 1 → 2; medium threshold 0 → 1; high threshold 6 → 5. Held through 2026-10-15 (7 days after the change was first seen).",
    );
    expect(e.outcome === "raised" && e.extra).toEqual({
      added: [{ key: C, weight: 1 }], removed: [{ key: B, weight: 3 }], changed: [{ key: A, from: 1, to: 2 }],
      thresholds: { from: { low: 0, medium: 0, high: 6 }, to: { low: 0, medium: 1, high: 5 } },
    });
  });

  it("detects a weight-only and a threshold-only change", () => {
    expect(flagSignerChange([prev({ issuerSigners: two }), cur({ issuerSigners: [{ key: A, weight: 1 }, { key: B, weight: 1 }] })]).outcome).toBe("raised");
    expect(flagSignerChange([prev(), cur({ issuerThresholds: { low: 1, medium: 0, high: 0 } })]).outcome).toBe("raised");
  });

  it("holds through seen day + 7, then clears naming the last change (S5)", () => {
    const changed = { issuerSigners: two };
    const series = (...days: string[]): ChecksSeries => [prev(), cur(changed), ...days.map((d) => at(d, changed))];
    expect(flagSignerChange(series("2026-10-15")).outcome).toBe("raised");
    const cleared = flagSignerChange(series("2026-10-16"));
    expect(cleared).toMatchObject({ outcome: "clear", as_of: "2026-10-16" });
    expect(text(cleared)).toBe(
      "No change in the issuer signers and thresholds in the 7 days before the check on 2026-10-16; the last change was seen between checks on 2026-10-06 and 2026-10-08.",
    );
  });

  it("describes the latest event in `extra`, and counts a revert as two changes", () => {
    const one = [{ key: A, weight: 1 }];
    const e = flagSignerChange([at("2026-10-06", { issuerSigners: one }), at("2026-10-08", { issuerSigners: two }), at("2026-10-09", { issuerSigners: one })]);
    expect(e.outcome === "raised" && e.extra).toMatchObject({ removed: [{ key: B, weight: 3 }], added: [] });
    expect(text(e)).toMatch(/removed GBBB…BBBB\(weight 3\)\. Held through 2026-10-16.* 2 changes in the last 7 days\.$/);
  });

  it("skips a failed middle row", () => {
    const failed = row({ identity: undefined, facts: undefined, error: "x" });
    expect(flagSignerChange([prev(), failed, cur({ issuerSigners: two })]).outcome).toBe("raised");
  });
});

describe("issuerChangeSeenAt (S4)", () => {
  const T08 = "2026-10-08T01:00:00.000Z";

  it("is null with no events, and with fewer than two rows", () => {
    expect(issuerChangeSeenAt([prev(), cur()])).toBeNull();
    expect(issuerChangeSeenAt([cur()])).toBeNull();
    expect(issuerChangeSeenAt([])).toBeNull();
    expect(issuerChangeSeenAt([undefined, undefined])).toBeNull();
  });

  it("is the checkedAt of the check that first showed the change", () => {
    expect(issuerChangeSeenAt(afterChange())).toBe(T08);
    // identical later checks never move it
    expect(issuerChangeSeenAt(afterChange("2026-10-15", "2026-10-16", "2026-12-01"))).toBe(T08);
  });

  it("is the latest of the flag and signer events", () => {
    const two = [{ key: A, weight: 1 }, { key: B, weight: 3 }];
    const series: ChecksSeries = [prev({ flags: OPEN }), at("2026-10-08", { flags: NEXT }), at("2026-10-10", { flags: NEXT, issuerSigners: two })];
    expect(issuerChangeSeenAt(series)).toBe("2026-10-10T01:00:00.000Z");
    const reverse: ChecksSeries = [prev({ issuerSigners: two }), at("2026-10-08", { issuerSigners: [{ key: A, weight: 1 }] }), at("2026-10-10", { issuerSigners: [{ key: A, weight: 1 }], flags: NEXT })];
    expect(issuerChangeSeenAt(reverse)).toBe("2026-10-10T01:00:00.000Z");
  });

  it("keeps the earlier value when the current row failed or is missing", () => {
    const failed = row({ file: "data/checks/2026-10-09.json", identity: undefined, facts: undefined, error: "timeout" });
    expect(issuerChangeSeenAt([...afterChange(), failed])).toBe(T08);
    expect(issuerChangeSeenAt([...afterChange(), undefined])).toBe(T08);
    expect(flagFlagChange([...afterChange(), failed]).outcome).toBe("not_evaluated");
  });

  it("reflects a revert: the later event counts", () => {
    expect(issuerChangeSeenAt([at("2026-10-06", { flags: OPEN }), at("2026-10-08", { flags: NEXT }), at("2026-10-10", { flags: OPEN })])).toBe("2026-10-10T01:00:00.000Z");
  });

  it("is non-null and not before the decider's change time whenever a decider is raised (property over fixtures)", () => {
    const two = [{ key: A, weight: 1 }, { key: B, weight: 3 }];
    const variants: Partial<AssetFacts>[] = [{}, { flags: NEXT }, { issuerSigners: two }, { flags: NEXT, issuerSigners: two }, { issuerThresholds: { low: 1, medium: 1, high: 1 } }, { flags: undefined }, { issuerSigners: undefined }];
    const days = ["2026-10-06", "2026-10-07", "2026-10-08", "2026-10-10", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-20"];
    const failed = (d: string) => row({ file: `data/checks/${d}.json`, identity: undefined, facts: undefined, error: "x" });
    let raisedCases = 0;
    let state = 12345; // mulberry32: a fixed seed, so the cases are the same on every run
    const rand = (n: number) => {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
    };
    for (let i = 0; i < 400; i++) {
      const len = 2 + rand(5);
      const chosen = [...days].sort(() => rand(3) - 1).slice(0, len).sort();
      const series: ChecksSeries = chosen.map((d) => (rand(8) === 0 ? failed(d) : rand(10) === 0 ? undefined : at(d, variants[rand(variants.length)])));
      const seen = issuerChangeSeenAt(series);
      for (const e of [flagFlagChange(series), flagSignerChange(series)]) {
        if (e.outcome !== "raised") continue;
        raisedCases++;
        expect(seen).not.toBeNull();
        // the decider's change time is the checkedAt of its evidence's second row (the check that first showed the change)
        const file = e.evidence[1].ref.split("#")[0];
        const seenRow = series.find((r) => r?.file === file);
        expect(seenRow?.facts?.checkedAt).toBeDefined();
        expect(Date.parse(seen!)).toBeGreaterThanOrEqual(Date.parse(seenRow!.facts!.checkedAt));
      }
    }
    expect(raisedCases).toBeGreaterThan(20);
  });

  it("is at least the change time named by a raised decider", () => {
    const two = [{ key: A, weight: 1 }, { key: B, weight: 3 }];
    const series: ChecksSeries = [prev({ flags: OPEN }), at("2026-10-08", { flags: NEXT }), at("2026-10-09", { flags: NEXT, issuerSigners: two })];
    expect(flagFlagChange(series).outcome).toBe("raised");
    expect(flagSignerChange(series).outcome).toBe("raised");
    expect(Date.parse(issuerChangeSeenAt(series)!)).toBeGreaterThanOrEqual(Date.parse("2026-10-08T01:00:00.000Z"));
    expect(issuerChangeSeenAt(series)).toBe("2026-10-09T01:00:00.000Z");
  });
});
