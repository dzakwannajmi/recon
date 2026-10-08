import { describe, expect, it } from "vitest";
import { check, identity, row } from "./fixtures";
import { flagTomlInconsistent } from "./toml";

describe("flagTomlInconsistent", () => {
  it("is not evaluated without a verified toml", () => {
    expect(flagTomlInconsistent(undefined, [])).toMatchObject({ outcome: "not_evaluated" });
    const e = flagTomlInconsistent(row({ identity: identity({ status: "unpinned" }) }), []);
    expect(e).toMatchObject({ outcome: "not_evaluated", reason: "The issuer's stellar.toml is not verified for this asset (identity status: unpinned)" });
  });

  it("is clear when the toml lists the code and no toml supply field differs", () => {
    expect(flagTomlInconsistent(row(), [check({ status: "consistent" })])).toMatchObject({ outcome: "clear", as_of: "2026-10-08" });
    expect(flagTomlInconsistent(row(), [])).toMatchObject({ outcome: "clear" });
  });

  it("raises a WARNING with the check statement, the examination, and the toml quote as evidence", () => {
    const e = flagTomlInconsistent(row(), [check()]);
    expect(e).toMatchObject({ outcome: "raised", severity: "WARNING" });
    if (e.outcome !== "raised") throw new Error("expected raised");
    expect(e.statement).toBe(check().statement);
    expect(e.evidence.map((r) => r.kind)).toEqual(["chain_check", "examination", "source_fact"]);
    expect(e.evidence[1].ref).toBe(`data/examinations/2026-10-08.json#${check().asset}#supply_vs_toml_fixed_number`);
    expect(e.evidence[2]).toMatchObject({ quote: 'fixed_number="100"', snapshot_sha256: "sha-toml", where: "[[CURRENCIES]] BB1, line 43" });
  });

  it("dates a result by the examination it read, not the chain check", () => {
    const old = { supply: "105.0000000", as_of: "2026-10-06T01:14:16.540Z" };
    expect(flagTomlInconsistent(row(), [check({ onchain: old })])).toMatchObject({ outcome: "raised", as_of: "2026-10-06" });
    const ok = flagTomlInconsistent(row(), [check({ status: "consistent", onchain: old })]);
    expect(ok).toMatchObject({ outcome: "clear", as_of: "2026-10-08" });
    expect(ok.outcome === "clear" && ok.reason).toContain("agrees with its toml supply fields (as of 2026-10-06)");
    // a listing problem is dated by the chain check, and the later date wins
    const both = flagTomlInconsistent(row({ identity: identity({ codeListed: false }) }), [check({ onchain: old })]);
    expect(both).toMatchObject({ outcome: "raised", as_of: "2026-10-08" });
  });

  it("also covers max_number and ignores supply checks against filings", () => {
    expect(flagTomlInconsistent(row(), [check({ check: "supply_vs_toml_max_number" })])).toMatchObject({ outcome: "raised" });
    expect(flagTomlInconsistent(row(), [check({ check: "supply_vs_filed_shares" })])).toMatchObject({ outcome: "clear" });
  });

  it("raises when the toml lists the issuer but not the code", () => {
    const e = flagTomlInconsistent(row({ identity: identity({ codeListed: false }) }), []);
    expect(e).toMatchObject({ outcome: "raised", severity: "WARNING", statement: "The stellar.toml at bitbondsto.com lists the issuer account but no [[CURRENCIES]] entry for BB1 (as of 2026-10-08)." });
  });

  it("joins several reasons into one result and keeps all evidence", () => {
    const e = flagTomlInconsistent(row({ identity: identity({ codeListed: false }) }), [check(), check({ check: "supply_vs_toml_max_number", statement: "Second." })]);
    expect(e.outcome === "raised" && e.statement).toContain("Second. The stellar.toml at bitbondsto.com");
    expect(e.outcome === "raised" && e.evidence).toHaveLength(5);
  });

  it("is not evaluated when it is unknown whether the code is listed", () => {
    expect(flagTomlInconsistent(row({ identity: identity({ codeListed: null }) }), [])).toMatchObject({ outcome: "not_evaluated" });
  });
});
