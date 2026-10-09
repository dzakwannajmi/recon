import { afterEach, describe, expect, it, vi } from "vitest";
import { describeError } from "./llm-errors";

describe("describeError", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("stores the name, HTTP status, and a short provider code, never the message", () => {
    const err = Object.assign(new Error("secret request detail"), { name: "AI_APICallError", statusCode: 429, data: { error: { status: "RESOURCE_EXHAUSTED" } } });
    expect(describeError(err)).toBe("AI_APICallError HTTP 429 RESOURCE_EXHAUSTED");
    expect(describeError(new Error("x"))).toBe("Error");
    expect(describeError("boom")).toBe("non-Error thrown");
    const groq = Object.assign(new Error("m"), { name: "AI_APICallError", statusCode: 413, data: { error: { code: "rate_limit_exceeded" } } });
    expect(describeError(groq)).toBe("AI_APICallError HTTP 413 rate_limit_exceeded");
  });

  it.each(["GEMINI_API_KEY", "GROQ_API_KEY", "OPENROUTER_API_KEY"])("redacts %s if it ever appears", (name) => {
    vi.stubEnv(name, "test-key-123");
    expect(describeError(Object.assign(new Error("x"), { name: "Err-test-key-123" }))).toBe("Err-[redacted]");
  });
});
