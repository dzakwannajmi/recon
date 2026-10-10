/**
 * Golden rule 1: the LLM proposes, code decides, and no LLM tool publishes.
 * Nothing the live app can reach (everything under agent/ and app/, followed through its imports,
 * however indirect) may import the signing client or the publisher, or ask for the signing key.
 */
import { describe, expect, it } from "vitest";
import { IS_TEST, reachable, realGraph, type Graph } from "../testing/import-graph";

/** Files under lib/feed that live code reachable from the app may import. */
const ALLOWED_FEED = new Set(["lib/feed/reader.ts", "lib/feed/encode.ts", "lib/feed/deployment.ts"]);
const feedFiles = (set: Set<string>) => [...set].filter((f) => f.toLowerCase().startsWith("lib/feed/") && !ALLOWED_FEED.has(f.toLowerCase()));
const keyGetterUsers = (set: Set<string>, g: Graph) =>
  [...set].filter((f) => f.toLowerCase() !== "agent/wallet.ts" && g.read(f).toLowerCase().includes("getagentkeypair"));

describe("golden rule 1: nothing the app can reach touches the signing path", () => {
  const g = realGraph();
  const roots = [...g.index.values()].filter((f) => /^(agent|app)\//.test(f) && !IS_TEST.test(f));
  const set = reachable(roots, g);

  it("starts from every non-test file under agent/ and app/ and follows imports", () => {
    expect(roots.length).toBeGreaterThanOrEqual(8);
    expect(roots).toContain("agent/tools.ts");
    expect(set.has("agent/wallet.ts")).toBe(true);
    expect(set.size).toBeGreaterThan(roots.length); // it reaches into lib/
    expect([...set].some((f) => f.startsWith("lib/flags/"))).toBe(true);
  });

  it("reaches neither lib/feed/client.ts nor lib/feed/publish.ts, nor any lib/feed file but reader.ts and encode.ts", () => {
    expect(set.has("lib/feed/client.ts")).toBe(false);
    expect(set.has("lib/feed/publish.ts")).toBe(false);
    expect(feedFiles(set)).toEqual([]);
  });

  it("no reachable file other than agent/wallet.ts mentions the signing keypair getter", () => {
    expect(keyGetterUsers(set, g)).toEqual([]);
  });

  it("the read-only modules do not import the signing client", () => {
    const fromReader = reachable(["lib/feed/reader.ts", "lib/feed/encode.ts"], g);
    expect(fromReader.has("lib/feed/client.ts")).toBe(false);
    expect(fromReader.has("lib/feed/publish.ts")).toBe(false);
    expect(keyGetterUsers(fromReader, g)).toEqual([]);
  });
});

describe("the guard itself catches what it must (in-memory graph)", () => {
  const graph = (files: Record<string, string>): Graph => ({
    index: new Map(Object.keys(files).map((f) => [f.toLowerCase(), f])),
    read: (rel) => files[rel],
  });

  it("finds a direct import", () => {
    const g = graph({ "agent/a.ts": 'import { x } from "../lib/feed/client";', "lib/feed/client.ts": "" });
    expect(reachable(["agent/a.ts"], g).has("lib/feed/client.ts")).toBe(true);
  });

  it("finds an indirect import through helpers, re-exports, index files and the @/ alias", () => {
    const g = graph({
      "app/api/agent/route.ts": 'import { h } from "@/lib/helpers";',
      "lib/helpers/index.ts": 'export * from "./deep";',
      "lib/helpers/deep.ts": 'export { publishBatch } from "../feed/client.js";',
      "lib/feed/client.ts": 'import { w } from "../../agent/wallet";',
      "agent/wallet.ts": "export const getAgentKeypair = 1;",
    });
    const set = reachable(["app/api/agent/route.ts"], g);
    expect(set.has("lib/feed/client.ts")).toBe(true);
    expect(set.has("agent/wallet.ts")).toBe(true);
  });

  it("resolves dynamic import(), require(), bare imports, and .mts/.cts/.tsx targets", () => {
    const g = graph({
      "agent/a.ts": 'const m = await import("./b"); const c = require("./c.cts"); import "./d";',
      "agent/b.tsx": "", "agent/c.cts": "", "agent/d.mts": 'import("../lib/feed/publish")', "lib/feed/publish.ts": "",
    });
    const set = reachable(["agent/a.ts"], g);
    expect([...set].sort()).toEqual(["agent/a.ts", "agent/b.tsx", "agent/c.cts", "agent/d.mts", "lib/feed/publish.ts"]);
  });

  it("matches paths case-insensitively", () => {
    const g = graph({ "agent/a.ts": 'import { x } from "../Lib/FEED/Client";', "lib/feed/client.ts": "" });
    expect(reachable(["agent/a.ts"], g).has("lib/feed/client.ts")).toBe(true);
  });

  it("ignores packages and does not follow test files", () => {
    const g = graph({ "agent/a.ts": 'import z from "zod"; import "./a.test";', "agent/a.test.ts": 'import "../lib/feed/client";', "lib/feed/client.ts": "" });
    expect([...reachable(["agent/a.ts"], g)]).toEqual(["agent/a.ts"]);
  });

  it("flags a key-getter mention outside wallet.ts and a forbidden feed file", () => {
    const g = graph({ "agent/a.ts": 'import "../lib/feed/verify"; const k = GetAgentKeypair();', "lib/feed/verify.ts": "" });
    const set = reachable(["agent/a.ts"], g);
    expect(feedFiles(set)).toEqual(["lib/feed/verify.ts"]);
    expect(keyGetterUsers(set, g)).toEqual(["agent/a.ts"]);
  });
});
