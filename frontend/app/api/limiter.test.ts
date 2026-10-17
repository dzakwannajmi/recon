/**
 * /api/agent and /api/command share one rate limiter, so the global bucket covers live command reads and model chats together.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetChatLimiter } from "@/lib/chat-limiter";

vi.mock("@/agent/agent", () => ({ MODEL: "m", runAgent: async () => ({ answer: "ok", steps: [] }) }));
vi.mock("@/agent/tools", () => ({ tools: [{ name: "get_asset_status", description: "", parameters: {}, run: async () => ({ found: false, note: "n" }) }] }));

const cmd = (route: { POST: (r: Request) => Promise<Response> }) =>
  route.POST(new Request("http://localhost/api/command", { method: "POST", body: JSON.stringify({ command: "status", code: "USTRY" }) }));
const chat = (route: { POST: (r: Request) => Promise<Response> }) =>
  route.POST(new Request("http://localhost/api/agent", { method: "POST", body: JSON.stringify({ messages: [{ role: "user", text: "hi" }] }) }));

describe("shared chat limiter", () => {
  beforeEach(() => {
    resetChatLimiter();
    vi.stubEnv("GEMINI_API_KEY", "g");
    vi.stubEnv("GLOBAL_RATE_LIMIT_PER_MIN", "3");
    vi.stubEnv("TRUST_PROXY", "");
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    resetChatLimiter();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("counts commands and model chats in the same global bucket, even in separately loaded route modules", async () => {
    vi.resetModules();
    const command = await import("./command/route");
    vi.resetModules();
    const agent = await import("./agent/route");
    expect((await cmd(command)).status).toBe(200);
    expect((await chat(agent)).status).toBe(200);
    expect((await cmd(command)).status).toBe(200);
    expect((await cmd(command)).status).toBe(429); // the bucket of 3 is used up across both routes
    expect((await chat(agent)).status).toBe(429);
  });
});
