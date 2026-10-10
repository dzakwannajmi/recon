import { describe, expect, it } from "vitest";
import { STELLAR_CHILD_ENV_NAMES, stellarChildEnv } from "./env";
import { exitCode, newRunState, stoppedSentence, type RunState } from "./outcome";

const state = (over: Partial<RunState>): RunState => ({ ...newRunState(), ...over });

describe("exitCode", () => {
  it("a failure before the paid request is 1, whatever else is set", () => {
    expect(exitCode(newRunState())).toBe(1);
    expect(exitCode(state({ confirmation: "confirmed" }))).toBe(1);
  });

  it("paid, delivered and confirmed on chain is 0; the replay check can only make it worse", () => {
    const paid = { paidSent: true, delivered: true, confirmation: "confirmed" } as const;
    expect(exitCode(state(paid))).toBe(0);
    expect(exitCode(state({ ...paid, replay: "refused" }))).toBe(0);
    expect(exitCode(state({ ...paid, replay: "not_refused" }))).toBe(3);
    expect(exitCode(state({ ...paid, replay: "second_transfer" }))).toBe(3);
    // The replay check itself failing to finish never reports "not settled" for a payment that was confirmed.
    expect(exitCode(state({ ...paid, replay: "unknown" }))).toBe(2);
  });

  it("delivered but contradicted by the chain is 3, and delivered but not readable on chain is 2", () => {
    expect(exitCode(state({ paidSent: true, delivered: true, confirmation: "mismatch" }))).toBe(3);
    expect(exitCode(state({ paidSent: true, delivered: true, confirmation: "unreadable" }))).toBe(2);
    expect(exitCode(state({ paidSent: true, delivered: true, confirmation: "pending" }))).toBe(2);
  });

  it("paid without a settled response: 2 when a transfer was found, 3 only when the chain poll found none", () => {
    expect(exitCode(state({ paidSent: true, chain: "found" }))).toBe(2);
    expect(exitCode(state({ paidSent: true, chain: "none" }))).toBe(3);
  });

  it("a throw after the paid request, before or during the chain poll, is never 1 and never claims 'not settled'", () => {
    expect(exitCode(state({ paidSent: true, chain: "pending" }))).toBe(2);
    expect(exitCode(state({ paidSent: true, chain: "unknown" }))).toBe(2);
  });
});

describe("stoppedSentence", () => {
  it("warns about the unknown outcome only after the paid request, and holds no library text", () => {
    expect(stoppedSentence(state({ paidSent: true }), "the chain check")).toContain("outcome is unknown");
    expect(stoppedSentence(state({}), "preflight")).toBe("Stopped during preflight before any payment was sent.");
  });
});

describe("stellarChildEnv", () => {
  it("passes only what stellar-cli needs to find its keystore", () => {
    const out = stellarChildEnv({
      PATH: "/usr/bin",
      HOME: "/home/x",
      XDG_CONFIG_HOME: "/home/x/.config",
      AGENT_SECRET_KEY: "should-not-pass",
      GEMINI_API_KEY: "should-not-pass",
      X402_PAY_TO: "should-not-pass",
      X402_TESTNET_AMOUNT: "should-not-pass",
      STELLAR_SECRET_KEY: "should-not-pass",
      STELLAR_ACCOUNT: "should-not-pass",
    });
    expect(out).toEqual({ PATH: "/usr/bin", HOME: "/home/x", XDG_CONFIG_HOME: "/home/x/.config" });
  });

  it("skips unset and empty values, and never lists a secret-looking name", () => {
    expect(stellarChildEnv({ PATH: "", HOME: undefined, USER: "u" })).toEqual({ USER: "u" });
    for (const name of STELLAR_CHILD_ENV_NAMES) expect(name).not.toMatch(/SECRET|KEY|TOKEN|X402|PASSWORD/);
  });
});
