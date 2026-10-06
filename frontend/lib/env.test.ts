import { afterEach, describe, expect, it, vi } from "vitest";
import { positiveInt } from "./env";

const NAME = "RECON_TEST_POSITIVE_INT";

afterEach(() => {
  delete process.env[NAME];
  vi.restoreAllMocks();
});

describe("positiveInt", () => {
  it("uses the default when the variable is missing or blank", () => {
    expect(positiveInt(NAME, 10)).toBe(10);
    process.env[NAME] = "  ";
    expect(positiveInt(NAME, 10)).toBe(10);
  });

  it("reads a valid positive integer", () => {
    process.env[NAME] = "250000";
    expect(positiveInt(NAME, 10)).toBe(250000);
  });

  it("falls back on typos instead of switching a guard off", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const bad of ["200k", "0", "-5", "1.5", "NaN", "Infinity"]) {
      process.env[NAME] = bad;
      expect(positiveInt(NAME, 10)).toBe(10);
    }
  });
});
