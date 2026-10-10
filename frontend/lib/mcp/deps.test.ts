import { afterEach, describe, expect, it, vi } from "vitest";
import { post } from "./testkit";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("realMcpDeps", () => {
  it("reads the global limit from the environment: with a limit of 1 the second POST is 429", async () => {
    vi.stubEnv("MCP_GLOBAL_RATE_LIMIT_PER_MIN", "1");
    vi.stubEnv("MCP_ALLOWED_ORIGINS", "");
    vi.resetModules();
    const { realMcpDeps } = await import("./deps");
    const { handleMcp } = await import("./http");
    const deps = realMcpDeps();
    expect(realMcpDeps()).toBe(deps); // one instance per server
    const init = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "1" } } };
    expect((await handleMcp(post(init), deps)).status).toBe(200);
    const second = await handleMcp(post(init), deps);
    expect(second.status).toBe(429);
    expect(second.headers.get("retry-after")).toBe("60");
  });

  it("falls back to the defaults for an invalid value", async () => {
    vi.stubEnv("MCP_GLOBAL_RATE_LIMIT_PER_MIN", "0");
    vi.resetModules();
    const { realMcpDeps } = await import("./deps");
    const { handleMcp } = await import("./http");
    const deps = realMcpDeps();
    const init = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "1" } } };
    for (let i = 0; i < 3; i++) expect((await handleMcp(post(init), deps)).status).toBe(200);
  });

  it("builds the library handler lazily and once", async () => {
    vi.resetModules();
    const { realMcpDeps } = await import("./deps");
    const deps = realMcpDeps();
    expect(deps.mcp()).toBe(deps.mcp());
  });
});
