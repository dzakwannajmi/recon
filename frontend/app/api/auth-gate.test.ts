/**
 * POST /api/agent and POST /api/command with AUTH_REQUIRED on and off. The user lookup is stubbed: no network, no cookies.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetChatLimiter } from "@/lib/chat-limiter";

const currentUserId = vi.fn();
vi.mock("@/lib/auth/server", () => ({ currentUserId: () => currentUserId() }));
vi.mock("@/agent/agent", () => ({ MODEL: "m", runAgent: vi.fn() }));

const SIGN_IN = { error: "Sign in with GitHub to use the agent." };
const req = (path: string, body: unknown) => new Request(`http://localhost${path}`, { method: "POST", body: JSON.stringify(body) });

async function routes() {
  vi.resetModules();
  return { agent: await import("./agent/route"), command: await import("./command/route") };
}

describe("sign-in gate on the chat routes", () => {
  beforeEach(() => {
    vi.stubEnv("TRUST_PROXY", "");
    currentUserId.mockReset();
    resetChatLimiter();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("answers 401 on both routes when required and signed out", async () => {
    vi.stubEnv("AUTH_REQUIRED", "true");
    currentUserId.mockResolvedValue(null);
    const { agent, command } = await routes();
    const a = await agent.POST(req("/api/agent", { messages: [{ role: "user", text: "hi" }] }));
    const c = await command.POST(req("/api/command", { command: "status", code: "USTRY" }));
    expect([a.status, c.status]).toEqual([401, 401]);
    expect(await a.json()).toEqual(SIGN_IN);
    expect(await c.json()).toEqual(SIGN_IN);
  });

  it("lets a signed-in user reach the route's own validation", async () => {
    vi.stubEnv("AUTH_REQUIRED", "true");
    currentUserId.mockResolvedValue("user-1");
    const { agent, command } = await routes();
    expect((await agent.POST(req("/api/agent", {}))).status).toBe(400);
    expect((await command.POST(req("/api/command", { command: "nope" }))).status).toBe(400);
  });

  it("does not look at the user at all when it is off", async () => {
    const { agent, command } = await routes();
    expect((await agent.POST(req("/api/agent", {}))).status).toBe(400);
    expect((await command.POST(req("/api/command", { command: "nope" }))).status).toBe(400);
    expect(currentUserId).not.toHaveBeenCalled();
  });

  it("reports the switch in GET /api/agent so the page can show the gate", async () => {
    const { agent } = await routes();
    expect((await (await agent.GET()).json()).authRequired).toBe(false);
    vi.stubEnv("AUTH_REQUIRED", "true");
    expect((await (await agent.GET()).json()).authRequired).toBe(true);
  });
});
