/**
 * The HTTP wrapper and the route module (spec 9: M9, M10). Raw requests, no client, no network.
 */
import { describe, expect, it } from "vitest";
import * as route from "@/app/api/mcp/route";
import { HTTP_MESSAGES } from "./copy";
import { finalize, handleMcp, parseAllowedOrigins, readBoundedText } from "./http";
import { MAX_BODY_BYTES } from "./limits";
import { URL_MCP, harness, post } from "./testkit";

const META = { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientInfo": { name: "t", version: "1" }, "io.modelcontextprotocol/clientCapabilities": {} };
const MODERN = { "mcp-protocol-version": "2026-07-28" };
const listTools = { jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: META } };
const initialize = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "1" } } };

const errorOf = async (res: Response) => (await res.json()) as { jsonrpc: string; id: null; error: { code: number; message: string } };

describe("M9: HTTP wrapper", () => {
  it("the route module exports only POST and maxDuration (10)", () => {
    expect(Object.keys(route).sort()).toEqual(["POST", "maxDuration"]);
    expect(route.maxDuration).toBe(10);
  });

  it("GET, PUT and DELETE are 405 with Allow: POST", async () => {
    const h = harness();
    for (const method of ["GET", "PUT", "DELETE"]) {
      const res = await handleMcp(new Request(URL_MCP, { method }), h.deps);
      expect(res.status, method).toBe(405);
      expect(res.headers.get("allow")).toBe("POST");
      expect((await errorOf(res)).error).toEqual({ code: -32000, message: HTTP_MESSAGES.method_not_allowed });
    }
    expect(h.mcpCalls()).toBe(0);
  });

  it("every wrapper error carries nosniff, no-store and a JSON content type", async () => {
    const h = harness();
    const res = await handleMcp(new Request(URL_MCP, { method: "GET" }), h.deps);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
  });

  it("the third POST over a global limit of 2 is 429 with Retry-After, even with an invalid body", async () => {
    const h = harness({ globalPerMin: 2 });
    expect((await handleMcp(post(initialize), h.deps)).status).toBe(200);
    expect((await handleMcp(post(initialize), h.deps)).status).toBe(200);
    const third = await handleMcp(post("{"), h.deps);
    expect(third.status).toBe(429);
    expect(third.headers.get("retry-after")).toBe("60");
    expect((await errorOf(third)).error.message).toBe(HTTP_MESSAGES.rate_limited);
    expect(h.logs).toEqual([]); // rate-limited requests are not logged
  });

  it("a request with an Origin is 403 unless it is listed; the origin is never echoed", async () => {
    const h = harness();
    const res = await handleMcp(post(initialize, { origin: "https://evil.example" }), h.deps);
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain("evil.example");
    expect((await handleMcp(post(initialize, { origin: "null" }), h.deps)).status).toBe(403);
    expect((await handleMcp(post(initialize, { origin: "not a url" }), h.deps)).status).toBe(403);
    expect((await handleMcp(post(initialize, { origin: "" }), h.deps)).status).toBe(403);
    expect(h.mcpCalls()).toBe(0);

    const allowed = harness({ env: { MCP_ALLOWED_ORIGINS: "https://good.example, nonsense ,http://localhost:3000/path" } });
    expect((await handleMcp(post(initialize, { origin: "https://good.example" }), allowed.deps)).status).toBe(200);
    expect((await handleMcp(post(initialize, { origin: "http://localhost:3000" }), allowed.deps)).status).toBe(200);
    expect((await handleMcp(post(initialize, { origin: "https://evil.example" }), allowed.deps)).status).toBe(403);
    // No Origin header: not a browser, continue.
    expect((await handleMcp(post(initialize), allowed.deps)).status).toBe(200);
  });

  it("parseAllowedOrigins normalizes and ignores invalid entries", () => {
    expect([...parseAllowedOrigins("https://a.example/x, junk,, http://b.example:8080")].sort()).toEqual(["http://b.example:8080", "https://a.example"]);
    expect(parseAllowedOrigins(undefined).size).toBe(0);
  });

  it("a Content-Type that is not JSON is 415", async () => {
    const h = harness();
    const res = await handleMcp(post(initialize, { "content-type": "text/plain" }), h.deps);
    expect(res.status).toBe(415);
    expect((await errorOf(res)).error.message).toBe(HTTP_MESSAGES.content_type);
    expect(h.logs).toMatchObject([{ event: "mcp_rejected", reason: "content_type" }]);
  });

  it("a body over 65,536 bytes is 413, with a Content-Length and without one", async () => {
    const h = harness();
    const big = "x".repeat(MAX_BODY_BYTES + 1);
    const without = await handleMcp(post(big), h.deps);
    expect(without.status).toBe(413);
    const withLength = await handleMcp(post(big, { "content-length": String(big.length) }), h.deps);
    expect(withLength.status).toBe(413);
    expect((await errorOf(withLength)).error.message).toBe(HTTP_MESSAGES.too_large);
    // A stream that lies about nothing and is over the cap is cancelled, not buffered.
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(new Uint8Array(32_768));
        if (pulled > 1000) controller.close();
      },
    });
    const streamed = await handleMcp(new Request(URL_MCP, { method: "POST", headers: { "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit), h.deps);
    expect(streamed.status).toBe(413);
    expect(pulled).toBeLessThan(10);
    expect(h.mcpCalls()).toBe(0);
  });

  it("a body at exactly the cap is read", async () => {
    const text = await readBoundedText(post("y".repeat(MAX_BODY_BYTES)), MAX_BODY_BYTES);
    expect(text).toHaveLength(MAX_BODY_BYTES);
  });

  it("a body that is not JSON is 400 with -32700", async () => {
    const h = harness();
    for (const body of ["{", ""]) {
      const res = await handleMcp(post(body), h.deps);
      expect(res.status).toBe(400);
      expect((await errorOf(res)).error).toEqual({ code: -32700, message: HTTP_MESSAGES.parse });
    }
    expect(h.mcpCalls()).toBe(0);
  });

  it("a batch (an empty array or two messages) is 400 with -32600 and the library is never asked", async () => {
    const h = harness();
    for (const body of [[], [initialize, listTools]]) {
      const res = await handleMcp(post(body), h.deps);
      expect(res.status).toBe(400);
      expect((await errorOf(res)).error).toEqual({ code: -32600, message: HTTP_MESSAGES.batch });
    }
    expect(h.mcpCalls()).toBe(0);
    expect(h.logs.map((l) => (l as { reason: string }).reason)).toEqual(["batch", "batch"]);
  });

  it("an unexpected throw is 500 with -32603 and the fixed sentence", async () => {
    const h = harness();
    h.deps.mcp = () => {
      throw new Error("secret detail /etc/passwd");
    };
    const res = await handleMcp(post(initialize), h.deps);
    expect(res.status).toBe(500);
    const text = JSON.stringify(await errorOf(res));
    expect(text).toContain(HTTP_MESSAGES.internal);
    expect(text).not.toContain("passwd");
  });

  it("a response over the cap is 500 and logged", async () => {
    const big = new Response("x".repeat(100), { headers: { "content-type": "application/json" } });
    await expect(finalize(big, 50)).rejects.toThrow();
    const h = harness();
    h.deps.mcp = () => ({ fetch: async () => new Response("x".repeat(600_000), { headers: { "content-type": "application/json" } }) }) as never;
    const res = await handleMcp(post(initialize), h.deps);
    expect(res.status).toBe(500);
    expect((await errorOf(res)).error.code).toBe(-32603);
    expect(h.logs).toMatchObject([{ event: "mcp_internal_error", where: "mcp_response_too_large" }]);
  });

  it("finalize passes a bodyless response through with the two headers", async () => {
    const res = await finalize(new Response(null, { status: 202 }));
    expect(res.status).toBe(202);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("a 2025-era request is answered over a short event stream, a modern one with JSON", async () => {
    const h = harness();
    const legacy = await handleMcp(post(initialize), h.deps);
    expect(legacy.status).toBe(200);
    expect(legacy.headers.get("content-type")).toContain("text/event-stream");
    expect(await legacy.text()).toContain("event: message");
    const modern = await handleMcp(post(listTools, { ...MODERN, "mcp-method": "tools/list" }), h.deps);
    expect(modern.status).toBe(200);
    expect(modern.headers.get("content-type")).toContain("application/json");
  });

  it("a notification gets 202 with no body", async () => {
    const h = harness();
    const res = await handleMcp(post({ jsonrpc: "2.0", method: "notifications/initialized" }, { "mcp-protocol-version": "2025-11-25" }), h.deps);
    expect(res.status).toBe(202);
    expect(await res.text()).toBe("");
  });

  it("a header that does not match the body is the library's 400 (-32020)", async () => {
    const h = harness();
    const res = await handleMcp(post(listTools, { ...MODERN, "mcp-method": "tools/call" }), h.deps);
    expect(res.status).toBe(400);
  });
});

describe("M10: listen and sessions", () => {
  it("a modern subscriptions/listen is answered in-band with an error and the response ends", async () => {
    const h = harness();
    const req = post({ jsonrpc: "2.0", id: 7, method: "subscriptions/listen", params: { _meta: META } }, { ...MODERN, "mcp-method": "subscriptions/listen" });
    const res = await handleMcp(req, h.deps);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: number; error: { code: number; message: string } };
    expect(body.id).toBe(7);
    expect(body.error.code).toBe(-32603);
  }, 2000);

  it("Mcp-Session-Id and Last-Event-ID are ignored and no session id is returned", async () => {
    const h = harness();
    const res = await handleMcp(post(listTools, { ...MODERN, "mcp-method": "tools/list", "mcp-session-id": "abc", "last-event-id": "5" }), h.deps);
    expect(res.status).toBe(200);
    expect(res.headers.get("mcp-session-id")).toBeNull();
    const legacy = await handleMcp(post(initialize, { "mcp-session-id": "abc" }), h.deps);
    expect(legacy.status).toBe(200);
    expect(legacy.headers.get("mcp-session-id")).toBeNull();
  });
});
