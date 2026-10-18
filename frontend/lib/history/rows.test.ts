import { describe, expect, it } from "vitest";
import { MAX_BUNDLE_BYTES, MAX_STEPS_BYTES, capSteps, evidenceRowFor, fromMessageRow, titleOf, toFeedbackRow, toMessageRow } from "./rows";

const G = "GBHNGLLIE3KWGKCHIKMHJ5HVZHYIK7WTBE4QF5PLAKL4CJGSEU7HZIW5";
const paid = { userId: "u1", payKind: "paid", assetCode: "USTRY", issuer: G, tx: "ab12", raw: JSON.stringify({ schema: "check-detail/1" }) };

describe("messages", () => {
  it("maps a message to a row, cuts text at 4000 characters, keeps steps only on agent rows", () => {
    const step = { tool: "check_asset", args: {}, result: { ok: true } };
    const user = toMessageRow("u1", "s1", "m1", { role: "user", text: "x".repeat(5000), steps: [step] });
    expect(user).toMatchObject({ id: "m1", session_id: "s1", user_id: "u1", role: "user", steps: null });
    expect(user?.text).toHaveLength(4000);
    expect(toMessageRow("u1", "s1", "m2", { role: "agent", text: "ok", steps: [step] })?.steps).toEqual([step]);
  });

  it("skips error messages and empty text", () => {
    expect(toMessageRow("u", "s", "m", { role: "agent", text: "boom", error: true })).toBeNull();
    expect(toMessageRow("u", "s", "m", { role: "user", text: "  " })).toBeNull();
  });

  it("drops steps over the size cap but keeps the answer", () => {
    const big = [{ tool: "t", args: {}, result: "x".repeat(MAX_STEPS_BYTES) }];
    expect(capSteps(big)).toBeNull();
    expect(toMessageRow("u", "s", "m", { role: "agent", text: "answer", steps: big })).toMatchObject({ text: "answer", steps: null });
    expect(capSteps([])).toBeNull();
  });

  it("reads a stored row back and rejects bad rows", () => {
    const step = { tool: "check_asset", args: {}, result: 1 };
    expect(fromMessageRow({ role: "agent", text: "hi", steps: [step, { nope: 1 }, null] })).toEqual({ role: "agent", text: "hi", steps: [step] });
    expect(fromMessageRow({ role: "user", text: "q", steps: [step] })).toEqual({ role: "user", text: "q" });
    expect(fromMessageRow({ role: "system", text: "x" })).toBeNull();
    expect(fromMessageRow({ role: "user", text: 5 })).toBeNull();
  });

  it("titles a chat from the first user message on one line, at most 120 characters", () => {
    expect(titleOf([{ role: "agent", text: "hello" }, { role: "user", text: "Check\n  USTRY please" }])).toBe("Check USTRY please");
    expect(titleOf([{ role: "user", text: "y".repeat(300) }])).toHaveLength(120);
    expect(titleOf([])).toBe("New chat");
  });
});

describe("evidenceRowFor", () => {
  it("builds a row after a successful payment by a signed-in user", () => {
    expect(evidenceRowFor(paid)).toEqual({ user_id: "u1", asset_code: "USTRY", issuer: G, bundle: { schema: "check-detail/1" }, settlement_tx: "ab12" });
  });

  it("stores nothing when signed out", () => {
    expect(evidenceRowFor({ ...paid, userId: null })).toBeNull();
  });

  it("stores nothing unless the payment state is paid", () => {
    for (const payKind of ["idle", "paying", "failed", "unknown"]) expect(evidenceRowFor({ ...paid, payKind })).toBeNull();
  });

  it("stores nothing without a settlement tx, an issuer, or a response", () => {
    expect(evidenceRowFor({ ...paid, tx: null })).toBeNull();
    expect(evidenceRowFor({ ...paid, issuer: null })).toBeNull();
    expect(evidenceRowFor({ ...paid, raw: null })).toBeNull();
  });

  it("rejects malformed asset, issuer, and non-object or non-JSON responses", () => {
    expect(evidenceRowFor({ ...paid, assetCode: "bad code" })).toBeNull();
    expect(evidenceRowFor({ ...paid, issuer: "GABC" })).toBeNull();
    expect(evidenceRowFor({ ...paid, raw: "not json" })).toBeNull();
    expect(evidenceRowFor({ ...paid, raw: "[1]" })).toBeNull();
    expect(evidenceRowFor({ ...paid, raw: "null" })).toBeNull();
  });

  it("enforces the 1 MB cap on a bundle", () => {
    const ok = JSON.stringify({ pad: "x".repeat(MAX_BUNDLE_BYTES - 20) });
    expect(evidenceRowFor({ ...paid, raw: ok })).not.toBeNull();
    expect(evidenceRowFor({ ...paid, raw: JSON.stringify({ pad: "x".repeat(MAX_BUNDLE_BYTES) }) })).toBeNull();
  });
});

describe("toFeedbackRow", () => {
  it("keeps a known reason on a thumbs down and trims the note", () => {
    expect(toFeedbackRow("u1", "f1", -1, "answer", { reason: "inaccurate", detail: "  wrong date \n" })).toEqual({ id: "f1", user_id: "u1", rating: -1, reason: "inaccurate", detail: "wrong date", answer: "answer" });
  });

  it("drops an unknown reason, ignores a reason on a thumbs up, and nulls an empty note", () => {
    expect(toFeedbackRow("u1", "f1", -1, "a", { reason: "made-up" }).reason).toBeNull();
    const up = toFeedbackRow("u1", "f1", 1, "a", { reason: "inaccurate", detail: "   " });
    expect(up.reason).toBeNull();
    expect(up.detail).toBeNull();
  });

  it("cuts the note to 1000 characters and the answer to 4000", () => {
    const row = toFeedbackRow("u1", "f1", 1, "x".repeat(5000), { detail: "y".repeat(2000) });
    expect(Array.from(row.detail!)).toHaveLength(1000);
    expect(Array.from(row.answer)).toHaveLength(4000);
  });
});
