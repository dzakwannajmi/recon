import { describe, expect, it } from "vitest";
import { flagIssuerIdentity } from "./identity";
import { identity, row } from "./fixtures";

describe("flagIssuerIdentity", () => {
  it("is not evaluated without a chain check or when the check failed", () => {
    expect(flagIssuerIdentity(undefined).outcome).toBe("not_evaluated");
    const failed = flagIssuerIdentity(row({ identity: undefined, facts: undefined, error: "Horizon timed out" }));
    expect(failed).toMatchObject({ outcome: "not_evaluated", reason: "The chain check failed: Horizon timed out" });
  });

  it("is clear when verified, with the stored reason and the chain check as evidence", () => {
    const e = flagIssuerIdentity(row());
    expect(e).toMatchObject({ outcome: "clear", as_of: "2026-10-08" });
    expect(e.outcome === "clear" && e.reason).toBe(identity().reason);
    expect(e.outcome === "clear" && e.evidence[0]).toMatchObject({ kind: "chain_check", ref: expect.stringContaining("data/checks/2026-10-08.json#BB1:") });
    expect(e.outcome === "clear" && e.evidence).toHaveLength(3);
  });

  it("takes severity from the stored status map, never from the reason", () => {
    const critical = flagIssuerIdentity(row({ identity: identity({ status: "domain_mismatch", reason: "The home_domain differs (as of 2026-10-08)" }) }));
    expect(critical).toMatchObject({ outcome: "raised", severity: "CRITICAL", statement: "The home_domain differs (as of 2026-10-08)" });
    const warning = flagIssuerIdentity(row({ identity: identity({ status: "toml_unreachable" }) }));
    expect(warning).toMatchObject({ outcome: "raised", severity: "WARNING" });
    expect(flagIssuerIdentity(row({ identity: identity({ status: "unpinned" }) }))).toMatchObject({ severity: "WARNING" });
    expect(flagIssuerIdentity(row({ identity: identity({ status: "issuer_not_found" }) }))).toMatchObject({ severity: "CRITICAL" });
  });
});
