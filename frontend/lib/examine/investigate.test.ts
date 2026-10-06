import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchTrustedJson } from "../chain/http";
import { investigateIdentityMismatch, investigateSupplyMismatch, lineOverlap, orgName } from "./investigate";

vi.mock("../chain/http", async (importOriginal) => ({ ...(await importOriginal<typeof import("../chain/http")>()), fetchTrustedJson: vi.fn() }));

const ISSUER = "GBB1";
const page = (records: object[], next?: string) => ({ _embedded: { records }, _links: next ? { next: { href: next } } : {} });
const pay = (overrides: object) => ({ type: "payment", created_at: "2025-09-01T00:00:00Z", transaction_hash: "t", ...overrides });

beforeEach(() => {
  vi.mocked(fetchTrustedJson).mockReset();
});

function horizon(payments: object[], operations: object[]) {
  vi.mocked(fetchTrustedJson).mockImplementation(async (url: string) => (url.includes("/payments") ? page(payments) : page(operations)));
}

const supplyCase = (reference = { label: "bitbondsto.com stellar.toml", tokens: "100" }) =>
  investigateSupplyMismatch({ asset: `BB1:${ISSUER}`, check: "supply_vs_toml_fixed_number", supply: "105.0000000", breakdown: { authorized: "105.0000000", liquidity_pools: "0.0000000" }, reference });

describe("investigateSupplyMismatch", () => {
  it("reconstructs issuance and only dates the crossing when the history is complete", async () => {
    const payments = [
      pay({ created_at: "2025-08-22T00:00:00Z", transaction_hash: "t1", from: ISSUER, to: "GA", amount: "60.0000000", asset_code: "BB1", asset_issuer: ISSUER }),
      pay({ created_at: "2025-09-01T00:00:00Z", transaction_hash: "t2", from: ISSUER, to: "GB", amount: "50.0000000", asset_code: "BB1", asset_issuer: ISSUER }),
      pay({ from: "GA", to: ISSUER, amount: "5.0000000", asset_code: "BB1", asset_issuer: ISSUER }),
      pay({ from: ISSUER, to: "GC", amount: "9.0000000", asset_type: "native" }),
    ];
    horizon(payments, [{ type: "create_account", created_at: "2025-08-21T00:00:00Z", transaction_hash: "t0" }]);
    const complete = await supplyCase();
    const history = complete.steps.find((s) => s.step === "issuance_history")!;
    expect(history.data).toMatchObject({ mints: 2, burns: 1, minted: "110.0000000", burned: "5.0000000", complete: true });
    expect(history.finding).toContain("first exceeded 100 on 2025-09-01 (tx t2)");
    expect(complete.limits).toEqual([]);

    horizon(payments, [{ type: "payment", created_at: "2025-08-22T00:00:00Z", transaction_hash: "t1" }]);
    const partial = await supplyCase();
    expect(partial.steps.find((s) => s.step === "issuance_history")!.finding).not.toContain("first exceeded");
    expect(partial.limits[0]).toContain("does not include the account's creation");
  });

  it("works with a non-integer documented amount", async () => {
    horizon([], [{ type: "create_account", created_at: "2025-08-21T00:00:00Z", transaction_hash: "t0" }]);
    const inv = await supplyCase({ label: "SEC N-MFP3", tokens: "686637083.5800000" });
    expect(inv.conclusion).toContain("686637083.5800000 tokens");
    expect(inv.conclusion).toContain("full payment history shows no issuing payment");
  });

  it("counts path payments by the asset the issuer sends, and only operations involving the asset", async () => {
    horizon(
      [
        pay({ type: "path_payment_strict_send", from: ISSUER, to: "GA", amount: "10.0000000", asset_code: "BB1", asset_issuer: ISSUER, source_asset_type: "native", source_amount: "3.0000000" }),
        pay({ type: "path_payment_strict_send", from: ISSUER, to: "GA", amount: "4.0000000", asset_type: "native", source_asset_code: "BB1", source_asset_issuer: ISSUER, source_amount: "7.0000000" }),
      ],
      [
        { type: "payment", created_at: "2025-08-22T00:00:00Z", transaction_hash: "t1" },
        { type: "clawback", created_at: "2025-09-05T00:00:00Z", transaction_hash: "t5", asset_code: "BB1", asset_issuer: ISSUER },
        { type: "manage_sell_offer", created_at: "2025-09-05T00:00:00Z", transaction_hash: "t6", selling_asset_type: "native", buying_asset_code: "USDC", buying_asset_issuer: "GU" },
        { type: "invoke_host_function", created_at: "2025-09-06T00:00:00Z", transaction_hash: "t7" },
      ],
    );
    const inv = await supplyCase();
    expect(inv.steps.find((s) => s.step === "issuance_history")!.data).toMatchObject({ mints: 1, minted: "7.0000000" });
    const other = inv.steps.find((s) => s.step === "other_operations")!;
    expect(other.finding).toContain("clawback ×1");
    expect(other.finding).not.toContain("manage_sell_offer");
    expect(inv.limits.some((l) => l.includes("1 smart-contract calls"))).toBe(true);
    expect(inv.conclusion).not.toMatch(/fraud|scam|fake/i);
  });
});

describe("investigateIdentityMismatch", () => {
  it("reports the funder, footprint, and toml similarity as neutral facts", async () => {
    vi.mocked(fetchTrustedJson).mockResolvedValue(page([{ type: "create_account", created_at: "2026-07-14T00:00:00Z", transaction_hash: "tx", funder: "GFUNDER" }]));
    const official = '[DOCUMENTATION]\nORG_NAME="Franklin Templeton"\nORG_URL="https://www.franklintempleton.com"\n';
    const inv = await investigateIdentityMismatch({
      code: "BENJI", issuer: "GLOOK", status: "domain_mismatch", homeDomain: "franklintempleton.co.com",
      pinned: { issuer: "GBHN", org: "Franklin Templeton", domain: "franklintempleton.com" },
      trustlines: 7, supply: "1000.0000000", toml: { url: "https://franklintempleton.co.com/.well-known/stellar.toml", text: official, sha256: "a".repeat(64) },
      officialToml: { url: "https://www.franklintempleton.com/.well-known/stellar.toml", text: official, sha256: "b".repeat(64) },
    });
    expect(inv.conclusion.startsWith("Issuer GLOOK shares the code BENJI with the pinned asset BENJI:GBHN (Franklin Templeton, franklintempleton.com)")).toBe(true);
    expect(inv.steps.find((s) => s.step === "account_origin")!.finding).toContain("by GFUNDER");
    expect(inv.steps.find((s) => s.step === "toml_comparison")!.data).toMatchObject({ sha256: "a".repeat(64), line_overlap: 1 });
    expect(inv.conclusion).not.toMatch(/fraud|scam|fake|impostor|official domain pinned/i);
  });

  it("reads ORG_NAME only from [DOCUMENTATION], as one short clean line", () => {
    expect(orgName('[DOCUMENTATION]\nORG_NAME="Acme <b>Fund</b>"\n')).toBe("Acme b Fund /b");
    expect(orgName('ORG_NAME="Outside"\n[DOCUMENTATION]\nORG_URL="x"')).toBeNull();
    expect(orgName(`[DOCUMENTATION]\nORG_NAME="${"x".repeat(200)}"`)).toBeNull();
    expect(orgName('[DOCUMENTATION]\nORG_NAME="multi\nline"')).toBeNull();
  });

  it("measures overlap on distinctive lines only", () => {
    expect(lineOverlap("a\nb\n# c\n\n", "a\nx")).toBe(0.5);
    expect(lineOverlap('[DOCUMENTATION]\nVERSION="2.0.0"\nORG_NAME="X"', '[DOCUMENTATION]\nVERSION="2.0.0"\nORG_NAME="Y"')).toBe(0);
    expect(lineOverlap("", "a")).toBe(0);
  });
});
