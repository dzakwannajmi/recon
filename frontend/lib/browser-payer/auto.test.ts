import { describe, expect, it } from "vitest";
import { decideAutoPay } from "./auto";

const base = { id: "cmd-1", settled: true, state: "ready" as const, pay: "idle" as const, hasUrl: true };

describe("decideAutoPay", () => {
  it("pays once for a typed command when the wallet is ready and idle, then never again for that id", () => {
    const spent = new Set<string>();
    expect(decideAutoPay({ ...base, spent })).toBe("pay");
    for (let i = 0; i < 5; i++) expect(decideAutoPay({ ...base, spent })).toBe("skip"); // re-render, remount, strict mode
  });

  it("waits until the wallet has been read, without spending the id", () => {
    const spent = new Set<string>();
    expect(decideAutoPay({ ...base, settled: false, spent })).toBe("wait");
    expect(spent.size).toBe(0);
    expect(decideAutoPay({ ...base, spent })).toBe("pay");
  });

  it("never pays for a card the model offered (no id)", () => {
    expect(decideAutoPay({ ...base, id: undefined, spent: new Set() })).toBe("skip");
  });

  it.each(["missing", "not_funded", "no_trustline", "no_usdc"] as const)("shows the setup card (skips) when the wallet is %s, and does not pay later when it becomes ready", (state) => {
    const spent = new Set<string>();
    expect(decideAutoPay({ ...base, state, spent })).toBe("skip");
    expect(decideAutoPay({ ...base, state: "ready", spent })).toBe("skip");
  });

  it.each(["paying", "paid", "failed", "unknown"] as const)("does not pay when the payment state is %s (the unknown-outcome gate included)", (pay) => {
    expect(decideAutoPay({ ...base, pay, spent: new Set() })).toBe("skip");
  });

  it("does not pay without a detail URL", () => {
    expect(decideAutoPay({ ...base, hasUrl: false, spent: new Set() })).toBe("skip");
  });

  it("decides separately for separate typed commands", () => {
    const spent = new Set<string>();
    expect(decideAutoPay({ ...base, id: "a", spent })).toBe("pay");
    expect(decideAutoPay({ ...base, id: "b", spent })).toBe("pay");
  });
});
