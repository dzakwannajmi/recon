import { describe, expect, it } from "vitest";
import type { LoadedAsset } from "@/lib/factsheet/load";
import { buildDemo, onchainFrom } from "./demo";

const STATEMENT =
  "Mismatch between bitbondsto.com stellar.toml ([[CURRENCIES]] BB1, line 43, fixed_number 2,667,360) and on-chain supply 2668351.5866776 as of 2026-10-15.";

const asset = (status: LoadedAsset["status"], statement = STATEMENT) =>
  ({
    asset_code: "BB1",
    issuer_org: "Bitbond Finance GmbH",
    status,
    raised: [
      {
        flag: "TOML_INCONSISTENT",
        outcome: "raised",
        statement,
        as_of: "2026-10-15",
        evidence: [
          { kind: "source_fact", ref: "x", quote: 'fixed_number="2,667,360"', where: "[[CURRENCIES]] BB1, line 43", source_url: "https://bitbondsto.com/.well-known/stellar.toml", snapshot_sha256: "ab".repeat(32) },
        ],
      },
    ],
  }) as unknown as LoadedAsset;

describe("onchainFrom", () => {
  it("reads the on-chain part of the statement", () => {
    expect(onchainFrom(STATEMENT)).toBe("supply 2668351.5866776");
  });
  it("returns null when the statement has no on-chain part", () => {
    expect(onchainFrom("The stellar.toml lists no entry for BB1 (as of 2026-10-15).")).toBeNull();
  });
});

describe("buildDemo", () => {
  it("copies the fields from the status file", () => {
    const d = buildDemo({ as_of: "2026-10-15", assets: [asset("WARNING")] });
    expect(d).toMatchObject({
      code: "BB1",
      status: "WARNING",
      asOf: "2026-10-15",
      flagName: "stellar.toml vs. on-chain",
      statement: STATEMENT,
      onchain: "supply 2668351.5866776",
      quote: 'fixed_number="2,667,360"',
      where: "[[CURRENCIES]] BB1, line 43",
    });
    expect(d?.sha256).toBe("ab".repeat(32));
  });
  it("returns null with no quoted flag or no status", () => {
    expect(buildDemo({ as_of: "2026-10-15", assets: [] })).toBeNull();
    expect(buildDemo({ as_of: "2026-10-15", assets: [asset(null)] })).toBeNull();
  });
});
