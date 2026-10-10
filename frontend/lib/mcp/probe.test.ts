import { describe, expect, it } from "vitest";
import { handleMcp } from "./http";
import { DEFAULT_URL, parseProbeArgs, parseSse, recordBody, recordingFetch, validateProbeUrl, type Exchange } from "./probe";
import { URL_MCP, harness, post } from "./testkit";

describe("probe arguments", () => {
  it("defaults to localhost and both eras, and reads no network", () => {
    expect(parseProbeArgs([])).toEqual({ help: false, url: DEFAULT_URL, eras: ["legacy", "modern"], out: null });
    expect(parseProbeArgs(["--help"]).help).toBe(true);
  });

  it("parses --url, --era, --out", () => {
    expect(parseProbeArgs(["--url", "https://example.com/api/mcp", "--era", "modern", "--out", "x"])).toMatchObject({ url: "https://example.com/api/mcp", eras: ["modern"], out: "x" });
    expect(parseProbeArgs(["--era", "both"]).eras).toEqual(["legacy", "modern"]);
  });

  it("accepts only localhost over http and https anywhere", () => {
    for (const ok of ["http://localhost:3917/api/mcp", "http://127.0.0.1:3000/api/mcp", "https://recon.example/api/mcp"]) expect(validateProbeUrl(ok), ok).not.toBeNull();
    for (const bad of ["http://example.com/api/mcp", "http://192.168.0.1/x", "ftp://localhost/x", "https://u:p@example.com/", "nonsense", "http://localhost.evil.example/"]) expect(validateProbeUrl(bad), bad).toBeNull();
  });

  it("refuses bad flags with a fixed sentence", () => {
    expect(() => parseProbeArgs(["--url", "http://example.com"])).toThrow("--url must be");
    expect(() => parseProbeArgs(["--era", "old"])).toThrow("--era must be");
    expect(() => parseProbeArgs(["--url"])).toThrow("needs a value");
    expect(() => parseProbeArgs(["--bogus"])).toThrow("Unknown argument");
  });
});

describe("probe recording", () => {
  it("parses event-stream data lines and JSON, and keeps other text", () => {
    expect(parseSse('event: message\ndata: {"a":1}\n\n: keepalive\ndata: nope\n')).toEqual([{ a: 1 }]);
    expect(recordBody('{"a":1}', "application/json")).toEqual({ a: 1 });
    expect(recordBody("event: message\ndata: [1]\n", "text/event-stream")).toEqual([[1]]);
    expect(recordBody("plain", "text/plain")).toBe("plain");
    expect(recordBody("", null)).toBeNull();
  });

  it("records an exchange with only the listed headers", async () => {
    const h = harness();
    const exchanges: Exchange[] = [];
    const f = recordingFetch(async (input) => handleMcp(input as Request, h.deps), exchanges, () => new Date("2026-10-10T12:00:00Z"));
    const init = { jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "1" } } };
    const sent = post(init, { authorization: "Bearer secret-token" });
    const res = await f(URL_MCP, { method: "POST", headers: sent.headers, body: JSON.stringify(init) });
    expect(res.status).toBe(200);
    expect(exchanges).toHaveLength(1);
    const ex = exchanges[0];
    expect(ex.seq).toBe(1);
    expect(ex.at).toBe("2026-10-10T12:00:00.000Z");
    expect(Object.keys(ex.request.headers)).toEqual(["content-type", "accept", "mcp-protocol-version", "mcp-method", "mcp-name"]);
    expect(JSON.stringify(ex)).not.toContain("secret-token");
    expect(ex.request.body).toEqual(init);
    expect(ex.response.headers["content-type"]).toContain("text/event-stream");
    expect(Array.isArray(ex.response.body)).toBe(true);
    // The body can still be read by the caller.
    expect(await res.text()).toContain("event: message");
  });
});
