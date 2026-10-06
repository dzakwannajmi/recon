import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearAssetCache, formatStroops, getAssetFacts, sacContractId, sharePercent, toStroops, totalSupply } from "./asset";
import { fetchTrustedJson } from "./http";
import { getAsset, getIssuerAccount, type AssetRecord, type IssuerAccount } from "./horizon";

vi.mock("./horizon", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./horizon")>()),
  getAsset: vi.fn(),
  getIssuerAccount: vi.fn(),
}));
vi.mock("./http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./http")>()),
  fetchTrustedJson: vi.fn(),
}));

const ISSUER = "GBHNGLLIE3KWGKCHIKMHJ5HVZHYIK7WTBE4QF5PLAKL4CJGSEU7HZIW5";
const FLAGS = { auth_required: true, auth_revocable: true, auth_immutable: false, auth_clawback_enabled: true };

const record = (overrides: Partial<AssetRecord> = {}): AssetRecord => ({
  asset_code: "BENJI",
  asset_issuer: ISSUER,
  accounts: { authorized: 1375, authorized_to_maintain_liabilities: 0, unauthorized: 995 },
  balances: { authorized: "90.0000000", authorized_to_maintain_liabilities: "0.0000000", unauthorized: "0.0000000" },
  claimable_balances_amount: "0.0000000",
  liquidity_pools_amount: "10.0000000",
  contracts_amount: "0.0000000",
  flags: FLAGS,
  ...overrides,
});

describe("stroop math", () => {
  it("parses and formats amounts exactly", () => {
    expect(toStroops("522773589.6259489")).toBe(5227735896259489n);
    expect(toStroops("1.5")).toBe(15000000n);
    expect(toStroops("0")).toBe(0n);
    expect(toStroops(undefined)).toBe(0n);
    expect(toStroops("-1")).toBe(0n);
    expect(formatStroops(5227735896259489n)).toBe("522773589.6259489");
    expect(formatStroops(1n)).toBe("0.0000001");
  });

  it("sums every balance component into the total supply", () => {
    const { total, breakdown } = totalSupply(
      record({
        balances: { authorized: "1.0000001", authorized_to_maintain_liabilities: "2", unauthorized: "3" },
        claimable_balances_amount: "4",
        liquidity_pools_amount: "5",
        contracts_amount: "6.0000002",
      }),
    );
    expect(formatStroops(total)).toBe("21.0000003");
    expect(breakdown.contracts).toBe("6.0000002");
  });

  it("computes a floored percent share and handles zero supply", () => {
    expect(sharePercent(3972n, 10000n)).toBe(39.72);
    expect(sharePercent(1n, 3n)).toBe(33.33);
    expect(sharePercent(5n, 0n)).toBeNull();
  });

  it("derives the mainnet SAC address from code and issuer", () => {
    expect(sacContractId("BENJI", ISSUER)).toBe("CCDSDPD7FXB74PFB2SYCHGQRWLXQRYRTQSPCVSRJ7FAOLOUGWEYAXQ7A");
  });
});

describe("getAssetFacts", () => {
  beforeEach(() => {
    clearAssetCache();
    vi.mocked(getAsset).mockReset();
    vi.mocked(getIssuerAccount).mockReset();
    vi.mocked(fetchTrustedJson).mockReset();
    vi.mocked(getIssuerAccount).mockResolvedValue({
      id: ISSUER,
      flags: FLAGS,
      signers: [{ key: ISSUER, weight: 1, type: "ed25519_public_key" }],
      thresholds: { low_threshold: 1, med_threshold: 2, high_threshold: 3 },
    } as IssuerAccount);
  });

  it("reports the largest holder's share on the same total-supply base", async () => {
    vi.mocked(getAsset).mockResolvedValue(record());
    vi.mocked(fetchTrustedJson).mockImplementation(async (url: string) =>
      url.includes("/holders")
        ? { _embedded: { records: [{ address: "GTOP", balance: "450000000" }] } } // 45 units
        : { trustlines: { total: 2370, authorized: 1375, funded: 1001 }, rating: { average: 9 } },
    );
    const facts = await getAssetFacts("BENJI", ISSUER);
    expect(facts.supply).toBe("100.0000000"); // 90 on trustlines + 10 in liquidity pools
    expect(facts.authorizedTrustlines).toBe(1375);
    expect(facts.fundedHolders).toBe(1001);
    expect(facts.largestHolder).toEqual({ address: "GTOP", balance: "45.0000000", sharePercent: 45 });
    expect(facts.sacContractId).toBe("CCDSDPD7FXB74PFB2SYCHGQRWLXQRYRTQSPCVSRJ7FAOLOUGWEYAXQ7A");
    expect(facts.issuerThresholds).toEqual({ low: 1, medium: 2, high: 3 });
    expect(JSON.stringify(facts)).not.toMatch(/rating/);
  });

  it("still returns Horizon facts when StellarExpert is unavailable", async () => {
    vi.mocked(getAsset).mockResolvedValue(record());
    vi.mocked(fetchTrustedJson).mockRejectedValue(new Error("down"));
    const facts = await getAssetFacts("BENJI", ISSUER);
    expect(facts.supply).toBe("100.0000000");
    expect(facts.fundedHolders).toBeNull();
    expect(facts.largestHolder).toBeNull();
  });

  it("reports a missing asset", async () => {
    vi.mocked(getAsset).mockResolvedValue(null);
    const facts = await getAssetFacts("NOPE", ISSUER);
    expect(facts.exists).toBe(false);
    expect(fetchTrustedJson).not.toHaveBeenCalled();
  });
});
