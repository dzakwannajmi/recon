import { describe, expect, it } from "vitest";
import type { Claim } from "../claims/store";
import type { UniverseAsset } from "../chain/universe";
import { claimsFor } from "./claims";

const ISSUER_A = "GAAAA";
const ISSUER_B = "GBBBB";
const universe = [
  { asset_code: "X", issuer: ISSUER_A, official_domain: "x.example" },
  { asset_code: "X", issuer: ISSUER_B, official_domain: "other.example" },
] as UniverseAsset[];
const claim = (asset: string, field: string): Claim => ({ id: `${asset}-${field}`, asset, field, verified: true, quote: "q" }) as unknown as Claim;

describe("claimsFor", () => {
  const claims = [claim("ISSUER:x.example", "auditor"), claim(`X:${ISSUER_A}`, "custodian"), claim(`X:${ISSUER_B}`, "custodian"), claim("Y:GCCCC", "custodian")];

  it("returns the asset's own claims first, then issuer-level facts of the same official domain", () => {
    const out = claimsFor(claims, universe, "X", ISSUER_A);
    expect(out.map((m) => [m.claim.asset, m.about])).toEqual([[`X:${ISSUER_A}`, "asset"], ["ISSUER:x.example", "issuer"]]);
  });

  it("without an issuer, matches every issuer of the code", () => {
    expect(claimsFor(claims, universe, "X").map((m) => m.claim.asset)).toEqual([`X:${ISSUER_A}`, `X:${ISSUER_B}`, "ISSUER:x.example"]);
  });

  it("filters by field when asked", () => {
    expect(claimsFor(claims, universe, "X", ISSUER_A, "auditor").map((m) => m.claim.field)).toEqual(["auditor"]);
  });
});
