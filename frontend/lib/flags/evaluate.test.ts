import { describe, expect, it } from "vitest";
import type { UniverseAsset } from "../chain/universe";
import { evaluateAsset, type RunInputs } from "./evaluate";
import { FORBIDDEN, ISSUER, check, facts, identity, row, snapshot } from "./fixtures";
import { assetStatus } from "./status";
import { FLAG_ORDER, type Evaluation } from "./types";

const asset = { asset_code: "BB1", issuer: ISSUER, issuer_org: "Bit Bond", asset_type: "fund" } as UniverseAsset;
const toml = snapshot({ sha256: "sha-toml", sourceClass: "issuer_toml", text: { kind: "text", chars: 900, pages: null, sha256: "t", extractor: "x" } });
const base = (over: Partial<RunInputs> = {}): RunInputs => ({
  asOf: "2026-10-08", checks: [row()], previousChecks: null, examinations: { file: "data/examinations/2026-10-08.json", checks: [] }, claims: [], sources: [], snapshots: [], ...over,
});
const text = (e: Evaluation) => (e.outcome === "raised" ? e.statement : e.reason);

describe("evaluateAsset", () => {
  it("returns exactly one evaluation per flag, in feed bit order", () => {
    expect(evaluateAsset(asset, base()).map((e) => e.flag)).toEqual(FLAG_ORDER);
  });

  it("leaves the Monitor flags not evaluated in v1", () => {
    const byFlag = Object.fromEntries(evaluateAsset(asset, base()).map((e) => [e.flag, e.outcome]));
    expect(byFlag).toMatchObject({ LARGE_MINT_BURN: "not_evaluated", PRICE_DEVIATION: "not_evaluated", FLAG_CHANGE: "not_evaluated", SIGNER_CHANGE: "not_evaluated" });
  });

  it("publishes nothing for an asset without a chain check", () => {
    const s = assetStatus(asset, evaluateAsset(asset, base({ checks: [] })), []);
    expect(s.status).toBeNull();
  });
});

describe("wording", () => {
  it("never produces fraud, grade, or rating language over a range of fixtures", () => {
    const all: Evaluation[] = [];
    const runs: RunInputs[] = [
      base(),
      base({ checks: [] }),
      base({ checks: [row({ identity: identity({ status: "domain_mismatch", reason: "The home_domain is not the pinned official domain (as of 2026-10-08)" }) })] }),
      base({ checks: [row({ identity: undefined, facts: undefined, error: "timeout" })] }),
      base({
        previousChecks: [row({ facts: facts({ checkedAt: "2026-10-06T00:00:00Z" }) })],
        checks: [row({ facts: facts({ flags: { auth_required: true, auth_revocable: true, auth_immutable: false, auth_clawback_enabled: true }, issuerThresholds: { low: 1, medium: 1, high: 1 } }) })],
        examinations: { file: "data/examinations/2026-10-08.json", checks: [check()] },
        snapshots: [toml],
      }),
      base({ snapshots: [toml, snapshot()] }),
    ];
    for (const run of runs) all.push(...evaluateAsset(asset, run));
    expect(all.length).toBeGreaterThan(50);
    for (const e of all) expect(text(e)).not.toMatch(FORBIDDEN);
  });
});
