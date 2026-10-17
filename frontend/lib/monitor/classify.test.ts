import fs from "fs";
import { describe, expect, it } from "vitest";
import { classifyOp, needsEffects, optionsChanges } from "./classify";
import { ETHERFUSE, FRANKLIN, HOLDER, SIGNER, op, payment } from "./testkit";
import type { HorizonEffect } from "./types";

const CODES = ["USTRY", "EUROB"];
const T = "2026-10-06T21:54:47Z";
const I = ETHERFUSE;
const asset = (code: string) => ({ asset_type: "credit_alphanum12", asset_code: code, asset_issuer: I });
const SU = (n: bigint) => n * 10_000_000n;

describe("classifyOp (C1: every row of the classification table)", () => {
  it("payment from the issuer is a mint, to the issuer a burn, for a pinned asset only", () => {
    expect(classifyOp(payment(10, T, "USTRY", I, I, HOLDER, "12.5000000"), I, CODES).supply).toEqual([{ asset: `USTRY:${I}`, side: "mint", amount: SU(12n) + 5_000_000n }]);
    expect(classifyOp(payment(10, T, "USTRY", I, HOLDER, I, "3.0000000"), I, CODES).supply).toEqual([{ asset: `USTRY:${I}`, side: "burn", amount: SU(3n) }]);
    // a holder to holder payment, an unpinned code (CETES), another issuer's asset, native: ignored
    expect(classifyOp(payment(10, T, "USTRY", I, HOLDER, FRANKLIN, "3"), I, CODES)).toMatchObject({ supply: [], unclassified: [], issuerChange: null });
    expect(classifyOp(payment(10, T, "CETES", I, I, HOLDER, "9"), I, CODES).supply).toEqual([]);
    expect(classifyOp(payment(10, T, "USTRY", FRANKLIN, I, HOLDER, "9"), I, CODES).supply).toEqual([]);
    expect(classifyOp(op("payment", 10, T, { asset_type: "native", from: I, to: HOLDER, amount: "1" }), I, CODES).supply).toEqual([]);
  });

  it("codes are case-sensitive", () => {
    expect(classifyOp(payment(10, T, "gBENJI", I, I, HOLDER, "1"), I, ["gBENJI"]).supply).toHaveLength(1);
    expect(classifyOp(payment(10, T, "GBENJI", I, I, HOLDER, "1"), I, ["gBENJI"]).supply).toHaveLength(0);
  });

  it("failed operations are ignored", () => {
    const failed = { ...payment(10, T, "USTRY", I, I, HOLDER, "5"), transaction_successful: false };
    expect(classifyOp(failed, I, CODES)).toMatchObject({ supply: [], unclassified: [], issuerChange: null });
    expect(classifyOp({ ...op("set_options", 10, T, { signer_key: SIGNER, signer_weight: 2 }), transaction_successful: false }, I, CODES).issuerChange).toBeNull();
  });

  it("path payments: source asset from the issuer mints source_amount, destination asset to the issuer burns amount", () => {
    const mint = op("path_payment_strict_send", 11, T, { from: I, to: HOLDER, source_asset_code: "USTRY", source_asset_issuer: I, source_amount: "7.0000000", asset_code: "XYZ", asset_issuer: FRANKLIN, amount: "6.0000000" });
    expect(classifyOp(mint, I, CODES).supply).toEqual([{ asset: `USTRY:${I}`, side: "mint", amount: SU(7n) }]);
    const burn = op("path_payment_strict_receive", 11, T, { from: HOLDER, to: I, source_asset_code: "XYZ", source_asset_issuer: FRANKLIN, source_amount: "8", ...asset("EUROB"), amount: "5.0000000" });
    expect(classifyOp(burn, I, CODES).supply).toEqual([{ asset: `EUROB:${I}`, side: "burn", amount: SU(5n) }]);
  });

  it("create_claimable_balance by the issuer mints; one made by a holder changes nothing", () => {
    const byIssuer = op("create_claimable_balance", 12, T, { source_account: I, asset: `USTRY:${I}`, amount: "100.0000000" });
    expect(classifyOp(byIssuer, I, CODES).supply).toEqual([{ asset: `USTRY:${I}`, side: "mint", amount: SU(100n) }]);
    const byHolder = op("create_claimable_balance", 12, T, { source_account: HOLDER, asset: `USTRY:${I}`, amount: "100.0000000" });
    expect(classifyOp(byHolder, I, CODES)).toMatchObject({ supply: [], unclassified: [] });
    expect(classifyOp(op("create_claimable_balance", 12, T, { source_account: I, asset: "native", amount: "1" }), I, CODES).supply).toEqual([]);
  });

  it("claim_claimable_balance by the issuer burns the sum of its account_credited effects (resolved from effects)", () => {
    const claim = op("claim_claimable_balance", 13, T, { source_account: I, balance_id: "0000" });
    expect(needsEffects(claim, I)).toBe(true);
    expect(needsEffects(payment(10, T, "USTRY", I, I, HOLDER, "1"), I)).toBe(false);
    const effects: HorizonEffect[] = [
      { type: "claimable_balance_claimed", account: I, amount: "40.0000000" },
      { type: "account_credited", account: I, ...asset("USTRY"), amount: "40.0000000" },
      { type: "account_credited", account: I, ...asset("USTRY"), amount: "2.0000000" },
      { type: "account_credited", account: I, ...asset("CETES"), amount: "9.0000000" },
      { type: "account_credited", account: HOLDER, ...asset("USTRY"), amount: "9.0000000" },
    ];
    expect(classifyOp(claim, I, CODES, effects).supply).toEqual([{ asset: `USTRY:${I}`, side: "burn", amount: SU(40n) }, { asset: `USTRY:${I}`, side: "burn", amount: SU(2n) }]);
    // only another asset credited: nothing for us, and not unclassified
    expect(classifyOp(claim, I, CODES, [{ type: "account_credited", account: I, ...asset("CETES"), amount: "9" }])).toMatchObject({ supply: [], unclassified: [] });
    // no account_credited effect at all, or effects not fetched: unclassified for every pinned asset of the issuer
    expect(classifyOp(claim, I, CODES, []).unclassified).toEqual([`USTRY:${I}`, `EUROB:${I}`]);
    expect(classifyOp(claim, I, CODES).unclassified).toEqual([`USTRY:${I}`, `EUROB:${I}`]);
    // a claim by a holder does not touch supply
    expect(classifyOp(op("claim_claimable_balance", 13, T, { source_account: HOLDER }), I, CODES)).toMatchObject({ supply: [], unclassified: [] });
    expect(classifyOp(op("clawback_claimable_balance", 13, T, { source_account: I }), I, CODES, effects).supply).toHaveLength(2);
  });

  it("clawback of a pinned asset burns", () => {
    const c = op("clawback", 14, T, { ...asset("EUROB"), from: HOLDER, amount: "4.0000000" });
    expect(classifyOp(c, I, CODES).supply).toEqual([{ asset: `EUROB:${I}`, side: "burn", amount: SU(4n) }]);
  });

  it("invoke_host_function: mint, burn, clawback, and transfers from or to the issuer", () => {
    const change = (type: string, extra: Record<string, unknown>, code = "USTRY") => ({ ...asset(code), type, amount: "10.0000000", ...extra });
    const call = (changes: unknown[]) => op("invoke_host_function", 15, T, { asset_balance_changes: changes });
    const r = classifyOp(call([
      change("mint", { to: HOLDER }), change("burn", { from: HOLDER }), change("clawback", { from: HOLDER }),
      change("transfer", { from: I, to: HOLDER }), change("transfer", { from: HOLDER, to: I }), change("transfer", { from: HOLDER, to: FRANKLIN }),
      change("mint", { to: HOLDER }, "CETES"),
    ]), I, CODES);
    expect(r.supply.map((s) => s.side)).toEqual(["mint", "burn", "burn", "mint", "burn"]);
    expect(r.supply.every((s) => s.amount === SU(10n) && s.asset === `USTRY:${I}`)).toBe(true);
    expect(classifyOp(op("invoke_host_function", 15, T, {}), I, CODES).supply).toEqual([]);
  });

  it("offers and pool operations naming a pinned asset are unclassified; other offers are ignored", () => {
    const offer = op("manage_sell_offer", 16, T, { selling_asset_code: "USTRY", selling_asset_issuer: I, buying_asset_type: "native", amount: "5", price: "1" });
    expect(classifyOp(offer, I, CODES)).toMatchObject({ supply: [], unclassified: [`USTRY:${I}`] });
    const pool = op("liquidity_pool_deposit", 16, T, { reserves_max: [{ asset: `EUROB:${I}`, amount: "1" }, { asset: "native", amount: "1" }] });
    expect(classifyOp(pool, I, CODES).unclassified).toEqual([`EUROB:${I}`]);
    expect(classifyOp(op("manage_sell_offer", 16, T, { selling_asset_code: "CETES", selling_asset_issuer: I }), I, CODES).unclassified).toEqual([]);
    expect(classifyOp(op("manage_sell_offer", 16, T, { source_account: HOLDER, selling_asset_code: "USTRY", selling_asset_issuer: I }), I, CODES).unclassified).toEqual([]);
  });

  it("anything else is ignored: trustline operations, sponsorship, merge by someone else", () => {
    for (const type of ["allow_trust", "set_trust_line_flags", "change_trust", "begin_sponsoring_future_reserves", "manage_data"]) {
      expect(classifyOp(op(type, 17, T), I, CODES), type).toMatchObject({ supply: [], unclassified: [], issuerChange: null });
    }
    expect(classifyOp(op("account_merge", 17, T, { source_account: HOLDER }), I, CODES).issuerChange).toBeNull();
  });

  it("account_merge by the issuer is an issuer_merged event", () => {
    expect(classifyOp(op("account_merge", 17, T, { source_account: I, into: HOLDER }), I, CODES).issuerChange).toEqual({ type: "issuer_merged", changes: [] });
  });

  it("the real Etherfuse set_options operations (2026-10-06, ledger 64807581) give the exact change lists", () => {
    const signer = op("set_options", 64807581, T, { signer_key: SIGNER, signer_weight: 2 });
    expect(classifyOp(signer, I, CODES).issuerChange).toEqual({ type: "issuer_options", changes: [`signer ${SIGNER} weight 2`] });
    const flags = op("set_options", 64807581, T, {
      master_key_weight: 5, set_flags: [2, 8], set_flags_s: ["auth_revocable", "auth_clawback_enabled"], low_threshold: 5, med_threshold: 5, high_threshold: 6,
    });
    expect(classifyOp(flags, I, CODES).issuerChange).toEqual({
      type: "issuer_options",
      changes: ["set flag auth_revocable", "set flag auth_clawback_enabled", "master key weight 5", "low threshold 5", "medium threshold 5", "high threshold 6"],
    });
    // a set_options by another account is not an issuer event
    expect(classifyOp(op("set_options", 1, T, { source_account: HOLDER, signer_key: SIGNER, signer_weight: 1 }), I, CODES).issuerChange).toBeNull();
  });

  it("set_options variants: clear flags, signer removed, home domain, hostile characters", () => {
    const o = op("set_options", 1, T, { clear_flags_s: ["auth_required"], signer_key: SIGNER, signer_weight: 0, home_domain: "evil\u0000\n.example" });
    expect(optionsChanges(o)).toEqual(["clear flag auth_required", `signer ${SIGNER} removed`, "home domain evil??.example"]);
    expect(optionsChanges(op("set_options", 1, T, { inflation_dest: HOLDER }))).toEqual([]);
  });
});

describe("C2: amounts are exact stroops, never floats", () => {
  it("keeps 7 decimals exactly and treats a malformed amount as unclassified", () => {
    const r = classifyOp(payment(10, T, "USTRY", I, I, HOLDER, "922337203685.4775807"), I, CODES);
    expect(r.supply[0].amount).toBe(9_223_372_036_854_775_807n);
    expect(classifyOp(payment(10, T, "USTRY", I, I, HOLDER, "0.1234567"), I, CODES).supply[0].amount).toBe(1_234_567n);
    for (const bad of ["1e5", "-1", "1.12345678", "abc", ""]) {
      const bad2 = classifyOp(payment(10, T, "USTRY", I, I, HOLDER, bad), I, CODES);
      expect(bad2, bad).toMatchObject({ supply: [], unclassified: [`USTRY:${I}`] });
    }
  });

  it("the Monitor's arithmetic modules use no floating point", () => {
    // Number() only appears for ledger numbers and a display percentage; no parseFloat anywhere.
    for (const f of ["classify", "reconcile", "issuance"]) {
      const text = fs.readFileSync(`${process.cwd()}/lib/monitor/${f}.ts`, "utf8");
      expect(text, f).not.toMatch(/parseFloat|\bNumber\(\s*(?!BigInt)[a-z]*amount/i);
    }
  });
});
