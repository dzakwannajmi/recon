/**
 * Golden rule 1: the LLM proposes, code decides, and no LLM tool publishes.
 * Nothing the live app can reach (everything under agent/ and app/, followed through its imports,
 * however indirect) may import the signing client or the publisher, or ask for the signing key.
 */
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "out", ".git"]);
const IS_TEST = /\.(test|spec)\.[cm]?[jt]sx?$/;

/** Every source file under a folder, as posix paths relative to ROOT. */
function listSources(dir: string, rel = ""): string[] {
  const abs = path.join(dir, rel);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) return SKIP_DIRS.has(e.name) ? [] : listSources(dir, r);
    return EXTENSIONS.some((x) => e.name.endsWith(x)) ? [r] : [];
  });
}

/** Module specifiers: import/export ... from, bare import, import(), require(). */
function specifiers(source: string): string[] {
  const out: string[] = [];
  const re = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)(["'`])([^"'`\n]+)\1/g;
  for (const m of source.matchAll(re)) out.push(m[2]);
  return out;
}

type Graph = {
  /** lower-case relative path -> real relative path (so `../Lib/Feed/Client` resolves like it does on a case-insensitive disk) */
  index: Map<string, string>;
  read: (rel: string) => string;
};

function resolve(spec: string, fromRel: string, g: Graph): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = spec.slice(2);
  else if (spec.startsWith("./") || spec.startsWith("../")) base = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec));
  else return null; // a package
  base = base.toLowerCase();
  const stripped = base.replace(/\.[cm]?[jt]sx?$/, ""); // `./x.js` may point at `x.ts`
  const candidates = [base, ...EXTENSIONS.map((x) => base + x), ...EXTENSIONS.map((x) => `${stripped}${x}`), ...EXTENSIONS.map((x) => `${base}/index${x}`)];
  for (const c of candidates) {
    const real = g.index.get(c);
    if (real) return real;
  }
  return null;
}

/** Everything reachable from the roots through relative and `@/` imports (test files are not followed). */
function reachable(roots: string[], g: Graph): Set<string> {
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of specifiers(g.read(file))) {
      const target = resolve(spec, file, g);
      if (target && !IS_TEST.test(target) && !seen.has(target)) queue.push(target);
    }
  }
  return seen;
}

const realGraph = (): Graph => {
  const files = ["agent", "app", "lib", "components", "scripts"].flatMap((d) => listSources(path.join(ROOT, d)).map((f) => `${d}/${f}`));
  return { index: new Map(files.map((f) => [f.toLowerCase(), f])), read: (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8") };
};

/** Files under lib/feed that live code reachable from the app may import. */
const ALLOWED_FEED = new Set(["lib/feed/reader.ts", "lib/feed/encode.ts"]);
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
