import { afterEach, describe, expect, it, vi } from "vitest";
import { describeError, PROVIDER_BUSY_MESSAGE, PROVIDER_DOWN_MESSAGE, providerFailure } from "./llm-errors";

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

describe("providerFailure", () => {
  const call = (statusCode: number) => Object.assign(new Error("provider said: secret request detail"), { name: "AI_APICallError", statusCode });
  const retry = (lastError: unknown) => Object.assign(new Error("Failed after 3 attempts"), { name: "AI_RetryError", lastError });

  it("maps a provider 429 and 503, also behind AI_RetryError.lastError or a cause, to fixed advice", () => {
    expect(providerFailure(call(429))).toEqual({ status: 429, message: PROVIDER_BUSY_MESSAGE });
    expect(providerFailure(call(503))).toEqual({ status: 503, message: PROVIDER_DOWN_MESSAGE });
    expect(providerFailure(retry(call(429)))?.status).toBe(429);
    expect(providerFailure(retry(call(503)))?.status).toBe(503);
    expect(providerFailure(new Error("x", { cause: call(503) }))?.status).toBe(503);
  });

  it("leaves other failures alone, never repeats provider text, and survives a cycle", () => {
    expect(providerFailure(call(500))).toBeNull();
    expect(providerFailure(call(401))).toBeNull();
    expect(providerFailure(new Error("boom"))).toBeNull();
    expect(providerFailure("string")).toBeNull();
    expect(JSON.stringify(providerFailure(call(429)))).not.toContain("secret");
    const a = Object.assign(new Error("a"), { lastError: undefined as unknown });
    a.lastError = a;
    expect(providerFailure(a)).toBeNull();
  });

  it("advises picking another model and does not promise a fallback", () => {
    for (const m of [PROVIDER_BUSY_MESSAGE, PROVIDER_DOWN_MESSAGE]) expect(m).toMatch(/Pick another model or try later/);
  });
});

describe("describeError behind a retry wrapper", () => {
  it("shows what an AI_RetryError wraps", () => {
    const inner = Object.assign(new Error("overloaded detail"), { name: "AI_APICallError", statusCode: 503, data: { error: { status: "UNAVAILABLE" } } });
    const retry = Object.assign(new Error("Failed after 3 attempts"), { name: "AI_RetryError", lastError: inner });
    expect(describeError(retry)).toBe("AI_RetryError > AI_APICallError HTTP 503 UNAVAILABLE");
  });
});
