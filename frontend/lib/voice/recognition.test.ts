import { describe, expect, it } from "vitest";
import { recognitionError } from "./recognition";

describe("recognitionError", () => {
  it("treats silence and aborts as no error", () => {
    expect(recognitionError("no-speech")).toBeNull();
    expect(recognitionError("aborted")).toBeNull();
  });
  it("marks a blocked or missing mic and a network failure as fatal, in plain words", () => {
    for (const code of ["not-allowed", "service-not-allowed", "audio-capture", "network", "language-not-supported"]) {
      const e = recognitionError(code);
      expect(e?.fatal).toBe(true);
      expect(e?.message).toMatch(/^[A-Z].*\.$/);
    }
  });
  it("treats an unknown code as a recoverable error", () => {
    expect(recognitionError("something-new")).toMatchObject({ fatal: false });
  });
});
