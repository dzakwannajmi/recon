import { describe, expect, it } from "vitest";
import type { Demo } from "./demo";
import { nextTab, STEPS, stepRows } from "./tabs";

const demo: Demo = {
  code: "BB1",
  issuerOrg: "Bitbond Finance GmbH",
  status: "WARNING",
  asOf: "2026-10-15",
  flagName: "stellar.toml vs. on-chain",
  statement: "Mismatch between x and on-chain supply 5 as of 2026-10-15.",
  onchain: "supply 5",
  quote: "q",
  where: "line 43",
  sourceUrl: "https://a.example/t.toml",
  sha256: "ff",
};

describe("nextTab", () => {
  it("moves with arrows and wraps", () => {
    expect(nextTab(0, "ArrowRight", 3)).toBe(1);
    expect(nextTab(2, "ArrowRight", 3)).toBe(0);
    expect(nextTab(0, "ArrowLeft", 3)).toBe(2);
    expect(nextTab(1, "ArrowDown", 3)).toBe(2);
    expect(nextTab(1, "ArrowUp", 3)).toBe(0);
  });
  it("jumps with Home and End, ignores other keys", () => {
    expect(nextTab(1, "Home", 3)).toBe(0);
    expect(nextTab(1, "End", 3)).toBe(2);
    expect(nextTab(1, "Enter", 3)).toBeNull();
    expect(nextTab(1, "a", 3)).toBeNull();
  });
});

describe("stepRows", () => {
  it("has the three steps of the approved copy", () => {
    expect(STEPS.map((s) => s.title)).toEqual([
      "The AI finds and reads",
      "Code checks the quote and the blockchain",
      "The result goes to a public feed",
    ]);
  });
  it("step 1 shows the quote with its source and location", () => {
    expect(stepRows(demo, 0).map((r) => [r.label, r.value])).toEqual([
      ["Quote", "q"],
      ["Source", "https://a.example/t.toml"],
      ["Location", "line 43"],
    ]);
  });
  it("step 2 puts the on-chain value next to the quote and the hash", () => {
    expect(stepRows(demo, 1).map((r) => [r.label, r.value])).toEqual([
      ["Blockchain", "supply 5 (as of 2026-10-15)"],
      ["Quote", "q"],
      ["Saved copy fingerprint", "ff"],
    ]);
  });
  it("step 3 shows the feed status and the date", () => {
    const rows = stepRows(demo, 2);
    expect(rows.find((r) => r.label === "Status")?.status).toBe("WARNING");
    expect(rows.find((r) => r.label === "As of")?.value).toBe("2026-10-15");
  });
  it("leaves out rows without data and falls back to the statement", () => {
    const bare = { ...demo, sourceUrl: null, where: null, sha256: null, onchain: null };
    expect(stepRows(bare, 0).map((r) => r.label)).toEqual(["Quote"]);
    expect(stepRows(bare, 1).map((r) => r.label)).toEqual(["Flag", "Quote"]);
  });
});
