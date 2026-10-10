import { describe, expect, it } from "vitest";
import { NOT_SHOWN, safeBool, safeValue } from "./safe";

describe("safeValue", () => {
  it("shows code-like strings", () => {
    for (const ok of ["WARNING", "2026-10-09", "NO_PUBLIC_DOCS", "payment_already_used", "stellar:testnet", "flags-v2", "check-detail/1".replace("/", "."), "a".repeat(80)]) {
      expect(safeValue(ok), ok).toBe(ok);
    }
  });

  it("hides spaces, newlines, escape sequences, long text, empty strings, and slashes", () => {
    const esc = String.fromCharCode(0x1b);
    for (const bad of ["two words", "line\nbreak", `${esc}[31mred`, `x${esc}`, "a".repeat(81), "", "check-detail/1", "paid 0.0004242 USDC", "tab\there", String.fromCharCode(0)]) {
      expect(safeValue(bad), JSON.stringify(bad)).toBe(NOT_SHOWN);
    }
  });

  it("hides everything that is not a string", () => {
    for (const bad of [undefined, null, 5, true, {}, ["a"], 12n]) expect(safeValue(bad)).toBe(NOT_SHOWN);
  });
});

describe("safeBool", () => {
  it("turns only real booleans into words and everything else into unknown", () => {
    expect(safeBool(true)).toBe("true");
    expect(safeBool(false)).toBe("false");
    for (const v of ["true", 1, null, undefined, "yes\nno"]) expect(safeBool(v)).toBe("unknown");
  });
});
