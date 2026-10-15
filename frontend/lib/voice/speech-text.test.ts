import { describe, expect, it } from "vitest";
import { MAX_SPOKEN_CHARS, markdownToSpeech, splitForSpeech } from "./speech-text";

describe("markdownToSpeech", () => {
  it("removes emphasis, headings, and list markers", () => {
    const out = markdownToSpeech("# Result\n\nThe **status** is *OK*.\n\n- first\n- second\n\n1. one\n2. two");
    expect(out).not.toMatch(/[#*_`]/);
    expect(out).toContain("Result");
    expect(out).toContain("The status is OK.");
    expect(out).toContain("first. second");
    expect(out).toContain("one. two");
  });
  it("reads a link by its label, not its URL", () => {
    const out = markdownToSpeech("See [the filing](https://www.sec.gov/Archives/x) for details.");
    expect(out).toBe("See the filing for details.");
  });
  it("keeps inline code text and drops fenced code", () => {
    const out = markdownToSpeech("Use `USTRY` here.\n\n```\nconst secret = 1;\n```\n\nDone.");
    expect(out).toContain("USTRY");
    expect(out).not.toContain("secret");
    expect(out).toContain("Done.");
  });
  it("does not double the full stop after a sentence", () => {
    expect(markdownToSpeech("One.\n\nTwo.")).toBe("One. Two.");
  });
  it("returns an empty string for empty input", () => {
    expect(markdownToSpeech("")).toBe("");
  });
  it("cuts very long text at a word boundary", () => {
    const out = markdownToSpeech("word ".repeat(1000));
    expect(out.length).toBeLessThanOrEqual(MAX_SPOKEN_CHARS);
    expect(out.endsWith("word")).toBe(true);
  });
});

describe("splitForSpeech", () => {
  it("splits into sentences within the limit and loses no text", () => {
    const text = "First sentence here. Second sentence follows! Third one? Last.";
    const parts = splitForSpeech(text, 30);
    expect(parts.every((p) => p.length <= 30)).toBe(true);
    expect(parts.join(" ")).toBe(text);
  });
  it("breaks one long sentence on spaces", () => {
    const parts = splitForSpeech("a ".repeat(200).trim(), 50);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= 50)).toBe(true);
  });
  it("returns nothing for empty text", () => {
    expect(splitForSpeech("")).toEqual([]);
  });
});
