import { describe, expect, it } from "vitest";
import { HANDOFF_KEY, MAX_QUERY_CHARS, cleanQuery, handoffFor, readHandoff, shouldAutoSend, storeHandoff } from "./handoff";

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
};

describe("handoff link", () => {
  it("builds an encoded /agent link from the text", () => {
    expect(handoffFor("Check USTRY & BENJI?")).toEqual({ href: "/agent?q=Check%20USTRY%20%26%20BENJI%3F", token: "Check USTRY & BENJI?" });
  });
  it("returns null for empty text", () => {
    expect(handoffFor("   ")).toBeNull();
  });
  it("caps the length and flattens control characters", () => {
    expect(cleanQuery("a".repeat(MAX_QUERY_CHARS + 50))).toHaveLength(MAX_QUERY_CHARS);
    expect(cleanQuery("one\ntwo\u0000three")).toBe("one two three");
  });
});

describe("readHandoff", () => {
  it("accepts a ?q= that matches what the landing page stored, once", () => {
    const store = memory();
    storeHandoff(store, "check USTRY");
    expect(readHandoff("?q=check%20USTRY", store)).toBe("check USTRY");
    expect(store.m.has(HANDOFF_KEY)).toBe(false);
    expect(readHandoff("?q=check%20USTRY", store)).toBeNull();
  });
  it("ignores a ?q= nobody stored (a forged link)", () => {
    expect(readHandoff("?q=fund%20your%20wallet", memory())).toBeNull();
  });
  it("ignores a ?q= that differs from the stored text", () => {
    const store = memory();
    storeHandoff(store, "check USTRY");
    expect(readHandoff("?q=something%20else", store)).toBeNull();
  });
  it("ignores a stored token without ?q= and clears it", () => {
    const store = memory();
    storeHandoff(store, "x");
    expect(readHandoff("", store)).toBeNull();
    expect(store.m.size).toBe(0);
  });
  it("does not throw when storage is blocked", () => {
    const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
    expect(() => storeHandoff(blocked, "x")).not.toThrow();
    expect(readHandoff("?q=x", blocked)).toBeNull();
  });
});

describe("shouldAutoSend", () => {
  const base = { query: "hi", ready: true, thinking: false, sent: false };
  it("sends once when ready and idle", () => {
    expect(shouldAutoSend(base)).toBe(true);
    expect(shouldAutoSend({ ...base, sent: true })).toBe(false);
  });
  it("waits for the agent to be set up and idle", () => {
    expect(shouldAutoSend({ ...base, ready: false })).toBe(false);
    expect(shouldAutoSend({ ...base, thinking: true })).toBe(false);
  });
  it("does nothing without a query", () => {
    expect(shouldAutoSend({ ...base, query: null })).toBe(false);
  });
});
