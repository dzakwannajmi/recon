/**
 * POST /api/command: slash commands that skip the model. No network: the tools are stubbed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetChatLimiter } from "@/lib/chat-limiter";

const calls: { name: string; args: unknown }[] = [];
const fake = (name: string, result: unknown) => ({
  name,
  description: "",
  parameters: {},
  run: async (args: unknown) => {
    calls.push({ name, args });
    return result;
  },
});
vi.mock("@/agent/tools", () => ({
  tools: [
    fake("get_asset_status", { found: true, assets: [{ code: "USTRY", status: "WARNING", as_of: "2026-10-08", raised_flags: [{ code: "F", statement: "Mismatch between A and B.", as_of: "2026-10-08" }], not_evaluated_count: 1 }] }),
    fake("get_verified_claims", { total_matching: 3, returned: 3, claims: [] }),
    fake("check_asset", { error: "asset_code must be 1-12 letters or digits." }),
    fake("get_evidence_bundle", { premium: true, available: true, asset_code: "USTRY", issuer: "G" }),
    fake("fund_my_wallet", { funded: true }),
  ],
}));
// A command must never reach a model: importing the LLM layer or calling generateText fails the test.
vi.mock("@/agent/llm", () => {
  throw new Error("the command route must not load the LLM layer");
});

async function load() {
  vi.resetModules();
  return import("./route");
}
const post = (route: Awaited<ReturnType<typeof load>>, body: unknown, headers: Record<string, string> = {}) =>
  route.POST(new Request("http://localhost/api/command", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) }));

describe("POST /api/command", () => {
  beforeEach(() => {
    calls.length = 0;
    resetChatLimiter();
    vi.stubEnv("TRUST_PROXY", "");
    vi.stubEnv("CHAT_RATE_LIMIT_PER_MIN", "");
    vi.stubEnv("GLOBAL_RATE_LIMIT_PER_MIN", "");
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it.each([
    ["status", "get_asset_status"],
    ["flags", "get_asset_status"],
    ["claims", "get_verified_claims"],
    ["check", "check_asset"],
    ["evidence", "get_evidence_bundle"],
  ])("runs only the matching tool for /%s, with the code as its only argument", async (command, tool) => {
    const route = await load();
    // Extra fields (a tool name, an issuer, a field) are ignored: the tool and its arguments are fixed server side.
    const res = await post(route, { command, code: "USTRY", tool: "fund_my_wallet", issuer: "GABC", field: "x" });
    expect(res.status).toBe(200);
    expect(calls).toEqual([{ name: tool, args: { asset_code: "USTRY" } }]);
    const body = await res.json();
    expect(body.steps).toEqual([expect.objectContaining({ tool, args: { asset_code: "USTRY" } })]);
    expect(body.text).toContain("No model was used");
  });

  it("answers /flags with the stored statements and /claims with a count", async () => {
    const route = await load();
    expect((await (await post(route, { command: "flags", code: "USTRY" })).json()).text).toContain("- Mismatch between A and B. (as of 2026-10-08)");
    expect((await (await post(route, { command: "claims", code: "USTRY" })).json()).text).toContain("3 verified claims");
  });

  it("refuses names outside the allowlist and codes that are not asset codes, before any tool runs", async () => {
    const route = await load();
    for (const body of [
      { command: "fund_my_wallet", code: "USTRY" },
      { command: "get_asset_status", code: "USTRY" },
      { command: "STATUS", code: "USTRY" },
      { command: "status", code: "US TRY" },
      { command: "status", code: "A".repeat(13) },
      { command: "status", code: "" },
      { command: "status", code: 5 },
      { command: "status" },
      { code: "USTRY" },
      [],
      null,
      "x",
    ]) {
      expect((await post(route, body)).status).toBe(400);
    }
    expect((await post(route, "{not json")).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it("refuses an oversized body", async () => {
    const route = await load();
    expect((await post(route, { command: "status", code: "USTRY", pad: "x".repeat(3000) })).status).toBe(413);
  });

  it("applies the per-IP and global rate limits", async () => {
    vi.stubEnv("TRUST_PROXY", "true");
    vi.stubEnv("CHAT_RATE_LIMIT_PER_MIN", "2");
    const route = await load();
    const ip = { "x-forwarded-for": "203.0.113.9" };
    expect((await post(route, { command: "status", code: "USTRY" }, ip)).status).toBe(200);
    expect((await post(route, { command: "status", code: "USTRY" }, ip)).status).toBe(200);
    const limited = await post(route, { command: "status", code: "USTRY" }, ip);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBeTruthy();
    expect((await post(route, { command: "status", code: "USTRY" }, { "x-forwarded-for": "203.0.113.10" })).status).toBe(200);
    expect(calls).toHaveLength(3);
  });

  it("keeps a failing tool from leaking its message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { tools } = await import("@/agent/tools");
    tools[0].run = async () => {
      throw new Error("db at /secret/path failed");
    };
    const route = await load();
    const res = await post(route, { command: "status", code: "USTRY" });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
  });
});
