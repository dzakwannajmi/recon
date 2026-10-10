import { describe, expect, it } from "vitest";
import { NOTICE, NO_CHECK_NOTE, SCOPE_NOTE } from "./copy";
import { buildSummary } from "./summary";
import { SENTINEL_AMOUNT, realAsset } from "./testkit";

const deployment = (data: ReturnType<typeof realAsset>["data"]) => data.deployment();

describe("buildSummary", () => {
  it("S1: gBENJI from the committed status file, with the statement byte for byte", () => {
    const k = realAsset("gBENJI");
    const body = buildSummary({ asset: k.asset, row: k.row, codeIsUnique: k.codeIsUnique, status: k.loaded, deployment: deployment(k.data), paidAvailable: true });
    expect(body).toMatchObject({
      schema: "check-summary/1",
      asset: { code: "gBENJI", issuer_org: "Franklin Templeton", type: "fund", official_domain: "franklintempleton.com" },
      status: "WARNING",
      as_of: "2026-10-09",
      rules_version: "flags-v2",
      counts: { raised: 1, clear: 4, not_evaluated: 4 },
      fact_sheet: "/en/assets/gBENJI",
      scope: SCOPE_NOTE,
      notice: NOTICE,
      source_file: "data/status/2026-10-09.json",
    });
    const raised = k.asset.raised[0];
    expect(body.raised_flags).toEqual([{ code: raised.flag, severity: raised.effective_severity, statement: raised.statement, as_of: raised.as_of }]);
    expect(body.raised_flags[0].statement).toBe(raised.statement);
    expect(body.feed).toMatchObject({ network: "stellar:testnet", key: k.asset.sac_contract_id, evidence_hash: k.asset.evidence_hash });
    expect(body.paid_detail).toEqual({
      path: `/api/check/detail?asset_code=gBENJI&issuer=${k.asset.issuer}`,
      protocol: "x402",
      network: "stellar:testnet",
      available: true,
    });
    expect(JSON.stringify(body)).not.toContain(SENTINEL_AMOUNT);
    expect(body).not.toHaveProperty("note");
  });

  it("reports paid_detail.available from the configuration, and a null fact sheet for a code that is not unique", () => {
    const k = realAsset("gBENJI");
    const body = buildSummary({ asset: k.asset, row: k.row, codeIsUnique: false, status: k.loaded, deployment: null, paidAvailable: false });
    expect(body.paid_detail.available).toBe(false);
    expect(body.fact_sheet).toBeNull();
    expect(body.feed).toBeNull();
  });

  it("S2: an asset with no chain check gives status null, no feed, and the note", () => {
    const k = realAsset("gBENJI");
    const unpublished = { ...k.asset, status: null, status_code: null, checked_at: null };
    const body = buildSummary({ asset: unpublished, row: k.row, codeIsUnique: true, status: k.loaded, deployment: deployment(k.data), paidAvailable: true });
    expect(body.status).toBeNull();
    expect(body.feed).toBeNull();
    expect(body.checked_at).toBeNull();
    expect(body).toMatchObject({ note: NO_CHECK_NOTE });
  });

  it("uses the effective severity, not the raw one", () => {
    const k = realAsset("gBENJI");
    const raised = { ...k.asset.raised[0], severity: "CRITICAL" as const, effective_severity: "WARNING" as const };
    const body = buildSummary({ asset: { ...k.asset, raised: [raised] }, row: k.row, codeIsUnique: true, status: k.loaded, deployment: null, paidAvailable: false });
    expect(body.raised_flags[0].severity).toBe("WARNING");
  });
});
