import { describe, expect, it } from "vitest";
import type { UniverseAsset } from "../chain/universe";
import { evaluateAsset, seriesFor, type RunInputs } from "./evaluate";
import { assetContext } from "./feed";
import { FORBIDDEN, ISSUER, check, facts, identity, row, snapshot } from "./fixtures";
import { assetStatus } from "./status";
import { FLAG_ORDER, type Evaluation } from "./types";

const FILE = { feed_schema: 1, rules_version: "flags-v2", inputs: { checks: { path: "data/checks/2026-10-08.json", sha256: "aa" } } };

const asset = { asset_code: "BB1", issuer: ISSUER, issuer_org: "Bit Bond", asset_type: "fund" } as UniverseAsset;
const toml = snapshot({ sha256: "sha-toml", sourceClass: "issuer_toml", text: { kind: "text", chars: 900, pages: null, sha256: "t", extractor: "x" } });
const base = (over: Partial<RunInputs> = {}): RunInputs => ({
  asOf: "2026-10-08", checks: [row()], earlierChecks: [], examinations: { file: "data/examinations/2026-10-08.json", checks: [] }, claims: [], sources: [], snapshots: [], ...over,
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
    const run = base({ checks: [] });
    const s = assetStatus(asset, evaluateAsset(asset, run), [], assetContext(asset, seriesFor(asset, run), FILE));
    expect(s.status).toBeNull();
    expect(s.checked_at).toBeNull();
  });

  it("builds the series from every earlier file, oldest first, with the current row last", () => {
    const old = row({ file: "data/checks/2026-10-04.json" });
    const mid = row({ file: "data/checks/2026-10-06.json" });
    const series = seriesFor(asset, base({ earlierChecks: [[old], [mid]] }));
    expect(series.map((r) => r?.file)).toEqual(["data/checks/2026-10-04.json", "data/checks/2026-10-06.json", "data/checks/2026-10-08.json"]);
    // an asset that is missing from the current file leaves an undefined last entry
    expect(seriesFor(asset, base({ earlierChecks: [[old]], checks: [] })).map((r) => r?.file)).toEqual(["data/checks/2026-10-04.json", undefined]);
  });
});

describe("hold window through evaluateAsset (S1)", () => {
  const OPEN = { auth_required: true, auth_revocable: false, auth_immutable: false, auth_clawback_enabled: false };
  const NEXT = { auth_required: true, auth_revocable: true, auth_immutable: false, auth_clawback_enabled: true };
  /** A row like the Etherfuse ones: identity cached earlier than the facts. */
  const at = (d: string, flags: typeof OPEN) =>
    row({ file: `data/checks/${d}.json`, identity: identity({ checkedAt: `${d}T01:34:10.000Z` }), facts: facts({ checkedAt: `${d}T01:34:21.021Z`, flags }) });
  const run = (current: string, asOf: string, ...between: string[]): RunInputs =>
    base({ asOf, earlierChecks: [[at("2026-10-06", OPEN)], [at("2026-10-08", NEXT)], ...between.map((d) => [at(d, NEXT)])], checks: [at(current, NEXT)] });
  const statusFor = (r: RunInputs) => assetStatus(asset, evaluateAsset(asset, r), [], assetContext(asset, seriesFor(asset, r), FILE));
  const change = (s: ReturnType<typeof statusFor>) => [s.raised.find((e) => e.flag === "FLAG_CHANGE") ?? s.clear.find((e) => e.flag === "FLAG_CHANGE")];

  it("is WARNING held through 2026-10-15, then OK on 2026-10-16 with the change time kept", () => {
    const held = statusFor(run("2026-10-15", "2026-10-15"));
    expect(held).toMatchObject({ status: "WARNING", flags_bitmask: 8, issuer_change_seen_at: "2026-10-08T01:34:21.021Z", checked_at: "2026-10-15T01:34:21.021Z" });
    expect(held.raised.map((r) => r.flag)).toEqual(["FLAG_CHANGE"]);
    const out = statusFor(run("2026-10-16", "2026-10-16", "2026-10-15"));
    expect(out).toMatchObject({ status: "OK", flags_bitmask: 0, issuer_change_seen_at: "2026-10-08T01:34:21.021Z", checked_at: "2026-10-16T01:34:21.021Z" });
    expect(change(out)[0]).toMatchObject({ outcome: "clear" });
    // the public text of both days
    expect(held.raised[0].statement).toBe(
      "Issuer authorization flags changed between checks on 2026-10-06 and 2026-10-08: auth_revocable false → true, auth_clawback_enabled false → true. Held through 2026-10-15 (7 days after the change was first seen).",
    );
    expect(out.clear.find((e) => e.flag === "FLAG_CHANGE")?.reason).toBe(
      "No change in the issuer authorization flags in the 7 days before the check on 2026-10-16; the last change was seen between checks on 2026-10-06 and 2026-10-08.",
    );
  });

  it("a status run with no new checks never clears a flag, however late the as-of", () => {
    const early = statusFor(run("2026-10-15", "2026-10-15"));
    const late = statusFor(run("2026-10-15", "2026-12-31"));
    expect(late.status).toBe("WARNING");
    expect(late.raised).toEqual(early.raised);
    expect(late.evidence_hash).toBe(early.evidence_hash); // the hash does not depend on as-of: it hashes the inputs, which are the same here
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
        earlierChecks: [[row({ facts: facts({ checkedAt: "2026-10-06T00:00:00Z" }) })]],
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
