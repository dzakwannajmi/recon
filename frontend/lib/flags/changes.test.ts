import { describe, expect, it } from "vitest";
import { flagFlagChange, flagSignerChange } from "./changes";
import { facts, row } from "./fixtures";

const A = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const B = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const C = "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";
const prev = (over = {}) => row({ file: "data/checks/2026-10-06.json", facts: facts({ checkedAt: "2026-10-06T09:00:00.000Z", ...over }) });
const cur = (over = {}) => row({ facts: facts(over) });

describe("flagFlagChange", () => {
  it("is not evaluated without both rows, or with a failed row or missing flags", () => {
    expect(flagFlagChange(undefined, cur())).toMatchObject({ outcome: "not_evaluated", reason: expect.stringContaining("No previous") });
    expect(flagFlagChange(prev(), undefined)).toMatchObject({ outcome: "not_evaluated", reason: expect.stringContaining("current") });
    expect(flagFlagChange(row({ identity: undefined, facts: undefined, error: "x" }), cur()).outcome).toBe("not_evaluated");
    expect(flagFlagChange(prev({ flags: undefined }), cur())).toMatchObject({ outcome: "not_evaluated", reason: "The previous chain check has no authorization flags" });
  });

  it("is clear when the four flags are the same, with both chain checks as evidence", () => {
    const e = flagFlagChange(prev(), cur());
    expect(e).toMatchObject({ outcome: "clear", as_of: "2026-10-08" });
    expect(e.outcome === "clear" && e.evidence.map((r) => r.ref)).toEqual([expect.stringContaining("2026-10-06"), expect.stringContaining("2026-10-08")]);
  });

  it("lists every change in key order", () => {
    const next = { auth_required: true, auth_revocable: true, auth_immutable: false, auth_clawback_enabled: true };
    const e = flagFlagChange(prev(), cur({ flags: next }));
    expect(e).toMatchObject({ outcome: "raised", severity: "WARNING" });
    expect(e.outcome === "raised" && e.statement).toBe(
      "Issuer authorization flags changed between checks on 2026-10-06 and 2026-10-08: auth_revocable false → true, auth_clawback_enabled false → true.",
    );
  });
});

describe("flagSignerChange", () => {
  const two = [{ key: A, weight: 1 }, { key: B, weight: 3 }];

  it("is not evaluated when signers or thresholds are missing", () => {
    expect(flagSignerChange(prev({ issuerSigners: undefined }), cur())).toMatchObject({ outcome: "not_evaluated", reason: "The previous chain check has no signers or thresholds" });
    expect(flagSignerChange(prev(), cur({ issuerThresholds: undefined })).outcome).toBe("not_evaluated");
    expect(flagSignerChange(undefined, undefined).outcome).toBe("not_evaluated");
  });

  it("treats a reordered signer list as no change", () => {
    expect(flagSignerChange(prev({ issuerSigners: two }), cur({ issuerSigners: [...two].reverse() })).outcome).toBe("clear");
  });

  it("reports added and removed signers, weight changes, and thresholds, abbreviating keys", () => {
    const e = flagSignerChange(
      prev({ issuerSigners: two, issuerThresholds: { low: 0, medium: 0, high: 6 } }),
      cur({ issuerSigners: [{ key: A, weight: 2 }, { key: C, weight: 1 }], issuerThresholds: { low: 0, medium: 1, high: 5 } }),
    );
    expect(e.outcome === "raised" && e.statement).toBe(
      "Issuer signers or thresholds changed between checks on 2026-10-06 and 2026-10-08: added GCCC…CCCC(weight 1); removed GBBB…BBBB(weight 3); GAAA…AAAA weight 1 → 2; medium threshold 0 → 1; high threshold 6 → 5.",
    );
    expect(e.outcome === "raised" && e.extra).toEqual({ added: [{ key: C, weight: 1 }], removed: [{ key: B, weight: 3 }] });
  });

  it("detects a weight-only and a threshold-only change", () => {
    expect(flagSignerChange(prev({ issuerSigners: two }), cur({ issuerSigners: [{ key: A, weight: 1 }, { key: B, weight: 1 }] })).outcome).toBe("raised");
    expect(flagSignerChange(prev(), cur({ issuerThresholds: { low: 1, medium: 0, high: 0 } })).outcome).toBe("raised");
  });
});
