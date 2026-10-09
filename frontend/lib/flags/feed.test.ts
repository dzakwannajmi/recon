import { describe, expect, it } from "vitest";
import { Asset, Networks } from "@stellar/stellar-sdk";
import type { UniverseAsset } from "../chain/universe";
import { assetContext, chainCheckedAt, resolveSacContractId } from "./feed";
import { ISSUER, facts, identity, row } from "./fixtures";

const FILE = { feed_schema: 1, rules_version: "flags-v2", inputs: {} };
const asset = { asset_code: "BB1", issuer: ISSUER, sac_contract_id: "" } as UniverseAsset;
const derived = new Asset("BB1", ISSUER).contractId(Networks.PUBLIC);

describe("chainCheckedAt (S6)", () => {
  it("is the later of identity.checkedAt and facts.checkedAt (TESOURO: identity cached earlier)", () => {
    const r = row({ identity: identity({ checkedAt: "2026-10-08T01:34:19.579Z" }), facts: facts({ checkedAt: "2026-10-08T01:34:21.021Z" }) });
    expect(chainCheckedAt(r)).toBe("2026-10-08T01:34:21.021Z");
    const later = row({ identity: identity({ checkedAt: "2026-10-08T05:00:00.000Z" }), facts: facts({ checkedAt: "2026-10-08T01:34:21.021Z" }) });
    expect(chainCheckedAt(later)).toBe("2026-10-08T05:00:00.000Z");
  });

  it("works with the identity or the facts alone", () => {
    expect(chainCheckedAt(row({ facts: undefined, identity: identity({ checkedAt: "2026-10-08T01:00:00.000Z" }) }))).toBe("2026-10-08T01:00:00.000Z");
    expect(chainCheckedAt(row({ identity: undefined, facts: facts({ checkedAt: "2026-10-08T02:00:00.000Z" }) }))).toBe("2026-10-08T02:00:00.000Z");
  });

  it("is null without a chain check: missing row, failed row, or no times", () => {
    expect(chainCheckedAt(undefined)).toBeNull();
    expect(chainCheckedAt(row({ error: "timeout", identity: undefined, facts: undefined }))).toBeNull();
    expect(chainCheckedAt(row({ identity: undefined, facts: undefined }))).toBeNull();
  });

  it("ignores a time that is not a real date", () => {
    expect(chainCheckedAt(row({ identity: identity({ checkedAt: "garbage" }), facts: facts({ checkedAt: "2026-10-08T02:00:00.000Z" }) }))).toBe("2026-10-08T02:00:00.000Z");
  });
});

describe("resolveSacContractId (S8)", () => {
  it("derives the mainnet SAC ID from code and issuer, and accepts an empty or equal CSV value", () => {
    expect(resolveSacContractId(asset)).toBe(derived);
    expect(resolveSacContractId({ ...asset, sac_contract_id: derived })).toBe(derived);
    expect(resolveSacContractId({ ...asset, sac_contract_id: `  ${derived}  ` })).toBe(derived);
    expect(derived).toMatch(/^C[A-Z2-7]{55}$/);
  });

  it("throws when the CSV lists a different contract ID", () => {
    expect(() => resolveSacContractId({ ...asset, sac_contract_id: "CAZGJD4BG6RLFQIAGPDPSX3IR73CBSVDEIBUDQGDZ3RCGGSOYSVBDSM7" })).toThrow(/derived from the code and issuer/);
  });

  it("matches the known SAC of BENJI (public passphrase, not testnet)", () => {
    expect(resolveSacContractId({ asset_code: "BENJI", issuer: "GBHNGLLIE3KWGKCHIKMHJ5HVZHYIK7WTBE4QF5PLAKL4CJGSEU7HZIW5", sac_contract_id: "" })).toBe("CCDSDPD7FXB74PFB2SYCHGQRWLXQRYRTQSPCVSRJ7FAOLOUGWEYAXQ7A");
  });
});

describe("assetContext", () => {
  it("builds the context from the same series the deciders read", () => {
    const old = row({ file: "data/checks/2026-10-06.json", facts: facts({ checkedAt: "2026-10-06T09:00:00.000Z" }) });
    const now = row({
      identity: identity({ checkedAt: "2026-10-08T01:34:19.579Z" }),
      facts: facts({ checkedAt: "2026-10-08T01:34:21.021Z", flags: { auth_required: true, auth_revocable: true, auth_immutable: false, auth_clawback_enabled: false } }),
    });
    expect(assetContext(asset, [old, now], FILE)).toEqual({
      ...FILE, sac_contract_id: derived, checked_at: "2026-10-08T01:34:21.021Z", issuer_change_seen_at: "2026-10-08T01:34:21.021Z",
    });
    // no change, no chain check
    expect(assetContext(asset, [old, row()], FILE).issuer_change_seen_at).toBeNull();
    expect(assetContext(asset, [old, undefined], FILE)).toMatchObject({ checked_at: null, issuer_change_seen_at: null });
  });
});
