import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import type { UniverseAsset } from "../chain/universe";
import type { LoadedAsset } from "../factsheet/load";
import { OUT_OF_SCOPE_STABLECOINS, parseQuery, resolveAsset } from "./resolve";

const acct = (n: number) => Keypair.fromRawEd25519Seed(Buffer.alloc(32, n)).publicKey();
const A = acct(10);
const B = acct(11);
const C = acct(12);

const asset = (code: string, issuer: string, org: string) => ({ asset: `${code}:${issuer}`, asset_code: code, issuer, issuer_org: org, asset_type: "fund", status: "OK" }) as unknown as LoadedAsset;
const row = (code: string, issuer: string, domain: string) => ({ asset_code: code, issuer, official_domain: domain }) as UniverseAsset;

const status = { assets: [asset("gBENJI", A, "Org A"), asset("TWIN", A, "Org A"), asset("TWIN", B, "Org B")] };
const universe = [row("gBENJI", A, "a.example"), row("TWIN", A, "a.example"), row("TWIN", B, "b.example")];

const q = (s: string) => parseQuery(new URLSearchParams(s));

describe("parseQuery (R2)", () => {
  it("accepts a code alone and a code with a valid issuer", () => {
    expect(q("asset_code=gBENJI")).toEqual({ asset_code: "gBENJI" });
    expect(q(`asset_code=gBENJI&issuer=${A}`)).toEqual({ asset_code: "gBENJI", issuer: A });
  });

  it("refuses a missing, empty, too long, or non-alphanumeric code", () => {
    expect(q("")).toBeNull();
    expect(q("asset_code=")).toBeNull();
    expect(q("asset_code=ABCDEFGHIJKLM")).toBeNull();
    expect(q("asset_code=a-b")).toBeNull();
    expect(q("asset_code=a%20b")).toBeNull();
  });

  it("refuses a bad issuer, including a wrong checksum and a secret seed", () => {
    expect(q("asset_code=X&issuer=")).toBeNull();
    expect(q("asset_code=X&issuer=GABC")).toBeNull();
    expect(q(`asset_code=X&issuer=${A.slice(0, -1)}${A.endsWith("A") ? "B" : "A"}`)).toBeNull();
    expect(q(`asset_code=X&issuer=${Keypair.fromRawEd25519Seed(Buffer.alloc(32, 10)).secret()}`)).toBeNull();
  });

  it("refuses an unknown parameter, a repeated parameter, and a value over 64 characters", () => {
    expect(q("asset_code=X&extra=1")).toBeNull();
    expect(q("asset_code=X&asset_code=Y")).toBeNull();
    expect(q(`asset_code=X&issuer=${A}&issuer=${A}`)).toBeNull();
    expect(q(`asset_code=X&issuer=${"G".repeat(65)}`)).toBeNull();
  });
});

describe("resolveAsset", () => {
  it("R1: finds a unique code without an issuer, and with the right issuer", () => {
    const a = resolveAsset({ asset_code: "gBENJI" }, status, universe);
    expect(a).toMatchObject({ kind: "found", codeIsUnique: true });
    expect(resolveAsset({ asset_code: "gBENJI", issuer: A }, status, universe)).toMatchObject({ kind: "found", codeIsUnique: true });
  });

  it("R3: an unknown code is not tracked, with case-insensitive look-alikes", () => {
    expect(resolveAsset({ asset_code: "gbenji" }, status, universe)).toEqual({ kind: "not_tracked", reason: "unknown_code", did_you_mean: ["gBENJI"] });
    expect(resolveAsset({ asset_code: "NOPE" }, status, universe)).toEqual({ kind: "not_tracked", reason: "unknown_code" });
  });

  it("R4: a stablecoin code is out of scope (exact case)", () => {
    for (const code of OUT_OF_SCOPE_STABLECOINS) expect(resolveAsset({ asset_code: code }, status, universe)).toEqual({ kind: "not_tracked", reason: "stablecoin_out_of_scope" });
    expect(resolveAsset({ asset_code: "usdc" }, status, universe)).toEqual({ kind: "not_tracked", reason: "unknown_code" });
  });

  it("R5: a wrong issuer lists the pinned issuers of the code", () => {
    const r = resolveAsset({ asset_code: "gBENJI", issuer: C }, status, universe);
    expect(r).toEqual({ kind: "not_tracked", reason: "issuer_not_pinned", tracked_issuers: [{ issuer: A, issuer_org: "Org A", official_domain: "a.example" }] });
  });

  it("R6: two issuers without an issuer parameter are ambiguous; with one, the right one is found and the code is not unique", () => {
    const r = resolveAsset({ asset_code: "TWIN" }, status, universe);
    expect(r).toEqual({
      kind: "ambiguous_asset",
      issuers: [
        { issuer: A, issuer_org: "Org A", official_domain: "a.example" },
        { issuer: B, issuer_org: "Org B", official_domain: "b.example" },
      ],
    });
    const picked = resolveAsset({ asset_code: "TWIN", issuer: B }, status, universe);
    expect(picked).toMatchObject({ kind: "found", codeIsUnique: false });
    if (picked.kind === "found") expect(picked.asset.issuer).toBe(B);
  });

  it("an official domain missing from the universe is null, not invented", () => {
    const r = resolveAsset({ asset_code: "TWIN" }, status, []);
    expect(r).toMatchObject({ kind: "ambiguous_asset", issuers: [{ official_domain: null }, { official_domain: null }] });
  });
});
