import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchTrustedJson } from "../chain/http";
import { investigateIdentityMismatch, investigateSupplyMismatch, lineOverlap } from "./investigate";

vi.mock("../chain/http", async (importOriginal) => ({ ...(await importOriginal<typeof import("../chain/http")>()), fetchTrustedJson: vi.fn() }));

const ISSUER = "GBB1";
const page = (records: object[]) => ({ _embedded: { records }, _links: {} });

beforeEach(() => {
  vi.mocked(fetchTrustedJson).mockReset();
});

describe("investigateSupplyMismatch", () => {
  it("reconstructs issuance from issuer payments and states the history's limits", async () => {
    vi.mocked(fetchTrustedJson).mockImplementation(async (url: string) => {
      return url.includes("/payments")
        ? page([
            { type: "payment", created_at: "2025-08-22T00:00:00Z", transaction_hash: "t1", from: ISSUER, to: "GA", amount: "60.0000000", asset_code: "BB1", asset_issuer: ISSUER },
            { type: "payment", created_at: "2025-09-01T00:00:00Z", transaction_hash: "t2", from: ISSUER, to: "GB", amount: "50.0000000", asset_code: "BB1", asset_issuer: ISSUER },
            { type: "payment", created_at: "2025-09-02T00:00:00Z", transaction_hash: "t3", from: "GA", to: ISSUER, amount: "5.0000000", asset_code: "BB1", asset_issuer: ISSUER },
            { type: "payment", created_at: "2025-09-03T00:00:00Z", transaction_hash: "t4", from: ISSUER, to: "GC", amount: "9.0000000", asset_code: "XLM" },
          ])
        : page([{ type: "payment", created_at: "2025-08-22T00:00:00Z", transaction_hash: "t1" }, { type: "clawback", created_at: "2025-09-05T00:00:00Z", transaction_hash: "t5" }]);
    });
    const inv = await investigateSupplyMismatch({ asset: `BB1:${ISSUER}`, check: "supply_vs_toml_fixed_number", supply: "105.0000000", breakdown: { authorized: "105.0000000", liquidity_pools: "0.0000000" }, reference: { label: "stellar.toml", value: 100 } });
    const history = inv.steps.find((s) => s.step === "issuance_history")!;
    expect(history.data).toMatchObject({ mints: 2, burns: 1, minted: "110.0000000", burned: "5.0000000" });
    expect(history.finding).toContain("first exceeded 100 on 2025-09-01 (tx t2)");
    expect(inv.steps.find((s) => s.step === "other_supply_operations")!.finding).toContain("clawback ×1");
    expect(inv.limits[0]).toContain("does not include the account's creation");
    expect(inv.conclusion).not.toMatch(/fraud|scam|fake/i);
  });
});

describe("investigateIdentityMismatch", () => {
  it("reports the funder, footprint, and toml similarity as facts", async () => {
    vi.mocked(fetchTrustedJson).mockResolvedValue(page([{ type: "create_account", created_at: "2026-07-14T00:00:00Z", transaction_hash: "tx", funder: "GFUNDER" }]));
    const official = 'ORG_NAME="Franklin Templeton"\nACCOUNTS=["GOFFICIAL"]\n';
    const inv = await investigateIdentityMismatch({
      code: "BENJI", issuer: "GLOOK", status: "domain_mismatch", homeDomain: "franklintempleton.co.com", officialDomains: ["franklintempleton.com"],
      trustlines: 7, supply: "1000.0000000", toml: { url: "https://franklintempleton.co.com/.well-known/stellar.toml", text: official, sha256: "a".repeat(64) },
      officialToml: { url: "https://www.franklintempleton.com/.well-known/stellar.toml", text: official, sha256: "b".repeat(64) },
    });
    expect(inv.steps.find((s) => s.step === "account_origin")!.finding).toContain("by GFUNDER");
    expect(inv.steps.find((s) => s.step === "toml_comparison")!.finding).toContain('ORG_NAME "Franklin Templeton", the same as the official toml; 100% of its lines');
    expect(inv.conclusion).not.toMatch(/fraud|scam|fake|impostor/i);
  });

  it("measures line overlap ignoring blanks and comments", () => {
    expect(lineOverlap("a\nb\n# c\n\n", "a\nx")).toBe(0.5);
    expect(lineOverlap("", "a")).toBe(0);
  });
});
