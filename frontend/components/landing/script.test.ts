import { describe, expect, it } from "vitest";
import type { Demo } from "./demo";
import { buildScript, endMs, frameAt, TIMING, totalChars, visibleParagraphs } from "./script";

const demo: Demo = {
  code: "BB1",
  issuerOrg: "Bitbond Finance GmbH",
  status: "WARNING",
  asOf: "2026-10-15",
  flagName: "stellar.toml vs. on-chain",
  statement: "Mismatch between bitbondsto.com stellar.toml ([[CURRENCIES]] BB1, line 43, fixed_number 2,667,360) and on-chain supply 2668351.5866776 as of 2026-10-15.",
  onchain: "supply 2668351.5866776",
  quote: 'fixed_number="2,667,360"',
  where: "[[CURRENCIES]] BB1, line 43",
  sourceUrl: null,
  sha256: null,
};

describe("buildScript", () => {
  const s = buildScript(demo);
  it("asks about the asset and states its status and date", () => {
    expect(s.prompt).toBe("Check BB1");
    expect(s.paragraphs[0]).toBe("BB1 (Bitbond Finance GmbH) has status WARNING as of 2026-10-15.");
  });
  it("carries the flag statement and the quote exactly as the data has them", () => {
    expect(s.paragraphs).toContain(demo.statement);
    expect(s.paragraphs.join("\n")).toContain(demo.quote);
    expect(demo.statement).toMatch(/^Mismatch between .+ \(.+\) and on-chain .+ as of \d{4}-\d{2}-\d{2}\.$/);
  });
  it("has no grade, score or accusation words", () => {
    expect(s.paragraphs.join(" ")).not.toMatch(/fraud|grade|score|rating|safe|scam/i);
  });
});

describe("frameAt", () => {
  const s = buildScript(demo);
  const answerAt = TIMING.promptAtMs + s.thinkMs;
  it("starts empty, then shows the prompt, then thinks, then types", () => {
    expect(frameAt(0, s)).toEqual({ promptShown: false, thinking: false, typed: 0, done: false });
    expect(frameAt(TIMING.promptAtMs, s)).toMatchObject({ promptShown: true, thinking: true, typed: 0 });
    expect(frameAt(answerAt - 1, s).thinking).toBe(true);
    const f = frameAt(answerAt + 1000, s);
    expect(f.thinking).toBe(false);
    expect(f.typed).toBe(TIMING.charsPerSecond);
  });
  it("is done at endMs and never types past the end", () => {
    expect(frameAt(endMs(s), s).done).toBe(true);
    expect(frameAt(endMs(s) + 99999, s).typed).toBe(totalChars(s));
    expect(frameAt(endMs(s) - 100, s).done).toBe(false);
  });
});

describe("visibleParagraphs", () => {
  it("cuts the joined text at n characters", () => {
    expect(visibleParagraphs(["abc", "defg"], 0)).toEqual([]);
    expect(visibleParagraphs(["abc", "defg"], 2)).toEqual(["ab"]);
    expect(visibleParagraphs(["abc", "defg"], 5)).toEqual(["abc", "de"]);
    expect(visibleParagraphs(["abc", "defg"], 99)).toEqual(["abc", "defg"]);
  });
});
