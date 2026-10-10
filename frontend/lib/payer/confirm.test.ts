import { describe, expect, it } from "vitest";
import { FAKE_TX_HASH, PAY_TO, SENTINEL_AMOUNT } from "../gateway/testkit";
import { confirmTransfer, paymentsSince, usdcTransfers, type BalanceChange, type HorizonOperation } from "./confirm";
import { USDC_TESTNET_ISSUER, baseToDecimal } from "./policy";

const PAYER = "GD436PARIAIVGQMI4O54RRKGBL6H7T3BPPKFSTYQGSG3727SXRCGE4S4";
const AMOUNT = BigInt(SENTINEL_AMOUNT);
const FACILITATOR = "GC6CSXBVEXAMPLEFACILITATOR";

const transfer = (over: Partial<BalanceChange> = {}): BalanceChange => ({
  asset_type: "credit_alphanum4",
  asset_code: "USDC",
  asset_issuer: USDC_TESTNET_ISSUER,
  type: "transfer",
  from: PAYER,
  to: PAY_TO,
  amount: baseToDecimal(AMOUNT),
  ...over,
});
const op = (changes: BalanceChange[], over: Partial<HorizonOperation> = {}): HorizonOperation => ({
  type: "invoke_host_function",
  transaction_hash: FAKE_TX_HASH,
  transaction_successful: true,
  created_at: "2026-10-10T12:00:10Z",
  asset_balance_changes: changes,
  source_account: FACILITATOR,
  ...over,
}) as HorizonOperation;
const tx = { hash: FAKE_TX_HASH, successful: true, ledger: 5200000 };
const want = { txHash: FAKE_TX_HASH, payer: PAYER, payTo: PAY_TO, amountBase: AMOUNT };

describe("confirmTransfer (L2)", () => {
  it("confirms exactly one matching USDC transfer from the payer to the receiver", () => {
    expect(confirmTransfer(tx, [op([transfer()])], want)).toEqual({ ok: true, ledger: 5200000 });
  });

  it("refuses a wrong receiver, payer, or amount", () => {
    expect(confirmTransfer(tx, [op([transfer({ to: PAYER })])], want)).toMatchObject({ ok: false, reason: expect.stringContaining("receiving") });
    expect(confirmTransfer(tx, [op([transfer({ from: PAY_TO })])], want)).toMatchObject({ ok: false, reason: expect.stringContaining("payer") });
    const wrong = confirmTransfer(tx, [op([transfer({ amount: baseToDecimal(AMOUNT + 1n) })])], want);
    expect(wrong).toMatchObject({ ok: false, reason: expect.stringContaining("amount") });
    expect(JSON.stringify(wrong)).not.toContain(SENTINEL_AMOUNT);
  });

  it("refuses two transfers, none, or a transfer of another asset", () => {
    expect(confirmTransfer(tx, [op([transfer(), transfer()])], want)).toMatchObject({ ok: false, reason: expect.stringContaining("more than one") });
    expect(confirmTransfer(tx, [op([transfer()]), op([transfer()])], want)).toMatchObject({ ok: false });
    expect(confirmTransfer(tx, [op([])], want)).toMatchObject({ ok: false, reason: expect.stringContaining("no USDC") });
    expect(confirmTransfer(tx, [op([transfer({ asset_issuer: PAYER })])], want)).toMatchObject({ ok: false, reason: expect.stringContaining("no USDC") });
    expect(confirmTransfer(tx, [op([transfer({ asset_code: "EURC" })])], want)).toMatchObject({ ok: false });
    expect(confirmTransfer(tx, [op([transfer({ type: "mint" })])], want)).toMatchObject({ ok: false });
  });

  it("refuses an unsuccessful transaction, another hash, or an unsuccessful operation", () => {
    expect(confirmTransfer({ ...tx, successful: false }, [op([transfer()])], want)).toMatchObject({ ok: false, reason: expect.stringContaining("did not succeed") });
    expect(confirmTransfer({ ...tx, hash: "00".repeat(32) }, [op([transfer()])], want)).toMatchObject({ ok: false });
    expect(confirmTransfer(tx, [op([transfer()], { transaction_successful: false })], want)).toMatchObject({ ok: false });
    expect(confirmTransfer({ hash: FAKE_TX_HASH, successful: true }, [op([transfer()])], want)).toMatchObject({ ok: false });
  });
});

describe("usdcTransfers and paymentsSince", () => {
  it("lists only credit_alphanum4 USDC transfers from the pinned issuer", () => {
    expect(usdcTransfers([op([transfer(), transfer({ asset_code: "EURC" }), transfer({ asset_issuer: PAYER })])])).toHaveLength(1);
  });

  it("finds payer-to-receiver transfers at or after the start time, once per transaction", () => {
    const since = new Date("2026-10-10T12:00:00Z");
    const old = op([transfer()], { created_at: "2026-10-10T11:59:00Z", transaction_hash: "11".repeat(32) });
    const fresh = op([transfer()], { transaction_hash: "22".repeat(32) });
    const failed = op([transfer()], { transaction_hash: "33".repeat(32), transaction_successful: false });
    const other = op([transfer({ to: PAYER })], { transaction_hash: "44".repeat(32) });
    expect(paymentsSince([fresh, old, failed, other, fresh], { payer: PAYER, payTo: PAY_TO, since })).toEqual(["22".repeat(32)]);
    expect(paymentsSince([old], { payer: PAYER, payTo: PAY_TO, since })).toEqual([]);
  });
});
