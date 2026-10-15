/**
 * Golden rules 1 and 8: the LLM proposes, code decides, no LLM tool publishes, and the web app holds no secret.
 * Nothing the live app can reach (everything under agent/ and app/ except agent/signer.ts, followed through its
 * imports, however indirect) may import the signing client, the publisher, or the signer, or load a secret key.
 * agent/signer.ts is the only file that loads the signing key, and only scripts/publish-feed.ts imports it.
 */
import { describe, expect, it } from "vitest";
import { IS_TEST, reachable, realGraph, resolve, secretReaders, specifiers, type Graph } from "../testing/import-graph";

/** The operator-only signing module: under agent/, but never reachable from the app. */
const SIGNER = "agent/signer.ts";
/** Files under lib/feed that live code reachable from the app may import. */
const ALLOWED_FEED = new Set(["lib/feed/reader.ts", "lib/feed/encode.ts", "lib/feed/deployment.ts"]);
const feedFiles = (set: Set<string>) => [...set].filter((f) => f.toLowerCase().startsWith("lib/feed/") && !ALLOWED_FEED.has(f.toLowerCase()));
const keyGetterUsers = (set: Set<string>, g: Graph) => [...set].filter((f) => g.read(f).toLowerCase().includes("getagentkeypair"));
const appRoots = (g: Graph) => [...g.index.values()].filter((f) => /^(agent|app)\//.test(f) && !IS_TEST.test(f) && f.toLowerCase() !== SIGNER);

describe("golden rules 1 and 8: nothing the app can reach touches the signing path or a secret", () => {
  const g = realGraph();
  const roots = appRoots(g);
  const set = reachable(roots, g);

  it("starts from every non-test file under agent/ and app/ but the signer, and follows imports", () => {
    expect(roots.length).toBeGreaterThanOrEqual(8);
    expect(roots).toContain("agent/tools.ts");
    expect(roots).toContain("agent/wallet.ts");
    expect(roots).toContain("app/api/wallet/route.ts");
    expect(set.size).toBeGreaterThan(roots.length); // it reaches into lib/
    expect([...set].some((f) => f.startsWith("lib/flags/"))).toBe(true);
  });

  it("reaches neither lib/feed/client.ts nor lib/feed/publish.ts, nor any lib/feed file but reader.ts and encode.ts", () => {
    expect(set.has("lib/feed/client.ts")).toBe(false);
    expect(set.has("lib/feed/publish.ts")).toBe(false);
    expect(feedFiles(set)).toEqual([]);
  });

  it("never reaches agent/signer.ts", () => {
    expect(g.index.has(SIGNER)).toBe(true);
    expect(set.has(SIGNER)).toBe(false);
  });

  it("no reachable file (agent/wallet.ts included) mentions the signing keypair getter", () => {
    expect(keyGetterUsers(set, g)).toEqual([]);
  });

  it("no reachable file (agent/wallet.ts included) loads a secret: no AGENT_SECRET_KEY, fromSecret, or secret-field read", () => {
    expect(secretReaders(set, g)).toEqual([]);
  });

  it("agent/signer.ts is imported only by scripts/publish-feed.ts, and it is the only agent/ file that loads a secret", () => {
    const importers = [...g.index.values()].filter(
      (f) => !IS_TEST.test(f) && specifiers(g.read(f)).some((spec) => resolve(spec, f, g) === SIGNER),
    );
    expect(importers).toEqual(["scripts/publish-feed.ts"]);
    const agentFiles = [...g.index.values()].filter((f) => f.startsWith("agent/") && !IS_TEST.test(f));
    expect(secretReaders(agentFiles, g).map((hit) => hit.split(":")[0])).toEqual([SIGNER]);
  });

  it("the read-only modules do not import the signing client", () => {
    const fromReader = reachable(["lib/feed/reader.ts", "lib/feed/encode.ts"], g);
    expect(fromReader.has("lib/feed/client.ts")).toBe(false);
    expect(fromReader.has("lib/feed/publish.ts")).toBe(false);
    expect(keyGetterUsers(fromReader, g)).toEqual([]);
    expect(secretReaders(fromReader, g)).toEqual([]);
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

  it("flags a key-getter mention anywhere reachable, and a forbidden feed file", () => {
    const g = graph({
      "agent/a.ts": 'import "../lib/feed/verify"; import "./wallet"; const k = GetAgentKeypair();',
      "agent/wallet.ts": "export const getAgentKeypair = 1;",
      "lib/feed/verify.ts": "",
    });
    const set = reachable(["agent/a.ts"], g);
    expect(feedFiles(set)).toEqual(["lib/feed/verify.ts"]);
    expect(keyGetterUsers(set, g).sort()).toEqual(["agent/a.ts", "agent/wallet.ts"]);
  });

  it("leaves the signer out of the roots, but sees it when a root imports it", () => {
    const g = graph({ "agent/tools.ts": 'import { w } from "./wallet";', "agent/wallet.ts": "", "agent/signer.ts": 'import "./wallet";' });
    expect(appRoots(g).sort()).toEqual(["agent/tools.ts", "agent/wallet.ts"]);
    expect(reachable(appRoots(g), g).has(SIGNER)).toBe(false);
    const bad = graph({ "agent/tools.ts": 'import { getAgentKeypair } from "./signer";', "agent/signer.ts": "" });
    expect(reachable(appRoots(bad), bad).has(SIGNER)).toBe(true);
  });

  it("flags every way of loading a secret, and not the one-time write of a fresh keypair", () => {
    const bad = [
      "const s = process.env.AGENT_SECRET_KEY;",
      "const k = Keypair.fromSecret(s);",
      "const k = Keypair.fromRawEd25519Seed(raw);",
      'const s = JSON.parse(fs.readFileSync(f, "utf8")).secret;',
      "const s = data?.secret;",
      'const s = data["secret"];',
      "const { publicKey, secret } = JSON.parse(text);",
    ];
    for (const src of bad) {
      const g = graph({ "agent/a.ts": src });
      expect(secretReaders(["agent/a.ts"], g), src).toHaveLength(1);
    }
    const ok = [
      "fs.writeFileSync(f, JSON.stringify({ publicKey: keypair.publicKey(), secret: keypair.secret() }, null, 2));",
      "const publicKey = (JSON.parse(text) as { publicKey?: unknown }).publicKey;",
      "type WalletFile = { publicKey: string; secret: string };",
      "// never reads the file's private field",
    ];
    for (const src of ok) {
      const g = graph({ "agent/a.ts": src });
      expect(secretReaders(["agent/a.ts"], g), src).toEqual([]);
    }
  });
});
