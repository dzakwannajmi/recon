/**
 * POST /api/agent: how provider trouble reaches the page. No network: the agent run is stubbed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetChatLimiter } from "@/lib/chat-limiter";

const runAgent = vi.fn();
vi.mock("@/agent/agent", () => ({ MODEL: "gemini-flash-latest", runAgent: (...a: unknown[]) => runAgent(...a) }));

async function load() {
  vi.resetModules();
  return { route: await import("./route"), llm: await import("@/agent/llm") };
}

const post = (route: { POST: (r: Request) => Promise<Response> }) =>
  route.POST(new Request("http://localhost/api/agent", { method: "POST", body: JSON.stringify({ messages: [{ role: "user", text: "check USTRY" }] }) }));
const api = (statusCode: number) => Object.assign(new Error("provider said: key AIza-secret"), { name: "AI_APICallError", statusCode });
const retry = (lastError: unknown) => Object.assign(new Error("Failed after 3 attempts"), { name: "AI_RetryError", lastError });

describe("POST /api/agent errors", () => {
  beforeEach(() => {
    vi.stubEnv("GEMINI_API_KEY", "g-secret");
    vi.stubEnv("LLM_PROVIDER", "google");
    vi.stubEnv("LLM_MODEL", "gemini-flash-latest");
    vi.stubEnv("TRUST_PROXY", "");
    runAgent.mockReset();
    resetChatLimiter();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("answers 429 with advice and Retry-After when the request limit is reached", async () => {
    const { route, llm } = await load();
    runAgent.mockRejectedValue(new llm.RequestLimitError(42));
    const res = await post(route);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
    expect((await res.json()).error).toBe("This model's request limit is reached. Pick another model or try later.");
  });

  it("finds our own request limit inside a retry wrapper and answers it with the clear 429 and Retry-After", async () => {
    const { route, llm } = await load();
    runAgent.mockRejectedValueOnce(retry(new llm.RequestLimitError(17)));
    const res = await post(route);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("17");
    expect((await res.json()).error).toBe("This model's request limit is reached. Pick another model or try later.");
    runAgent.mockRejectedValueOnce(Object.assign(new Error("outer"), { cause: retry(new llm.RequestLimitError(9)) }));
    expect((await post(route)).headers.get("Retry-After")).toBe("9");
  });

  it("maps a provider 429 behind AI_RetryError to 429, and a 503 to 503, with fixed words only", async () => {
    const { route } = await load();
    runAgent.mockRejectedValueOnce(retry(api(429)));
    const busy = await post(route);
    expect(busy.status).toBe(429);
    runAgent.mockRejectedValueOnce(retry(api(503)));
    const down = await post(route);
    expect(down.status).toBe(503);
    for (const r of [busy, down]) {
      const { error } = await r.json();
      expect(error).toMatch(/Pick another model or try later/);
      expect(error).not.toMatch(/secret|AIza/);
    }
    // One run per request: no silent fallback to another model or provider.
    expect(runAgent).toHaveBeenCalledTimes(2);
    expect(runAgent.mock.calls.every((c) => (c[1] as { provider: string }).provider === "google")).toBe(true);
  });

  it("logs the cause with describeError, never the message, and keeps other failures generic", async () => {
    const { route } = await load();
    runAgent.mockRejectedValue(retry(api(429)));
    await post(route);
    expect(console.error).toHaveBeenCalledWith("Agent request failed:", "AI_RetryError > AI_APICallError HTTP 429");
    runAgent.mockRejectedValue(api(500));
    const res = await post(route);
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Something went wrong. Try again in a moment.");
  });
});
