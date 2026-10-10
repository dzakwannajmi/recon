/**
 * Golden rules 1, 6, 7, and 8 for the check routes.
 *  - G1: no LLM, no signing key, and no x402 client code is reachable from app/api/check/**,
 *        and nothing under agent/ or app/ reaches the payer helpers or the paywall.
 *  - G2: the payer CLI and its helpers never touch the agent wallet.
 *  - G3: a tripwire for revenue (rule 7): no price literal in the files that build the paid route or the MCP endpoint.
 *  - G4: the MCP endpoint reaches no paywall, feed client, LLM, payer, or x402 client code, and adds one package.
 */
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { IS_TEST, ROOT, packageSpecifiers, packageSpecifiersOfSource, reachable, realGraph, resolve, specifiers, type Graph } from "../testing/import-graph";

const g = realGraph();
const files = [...g.index.values()];
const checkRoots = files.filter((f) => f.startsWith("app/api/check/") && !IS_TEST.test(f));
const checkSet = reachable(checkRoots, g);

const FORBIDDEN_FILES = ["agent/llm.ts", "agent/agent.ts", "agent/tools.ts", "agent/wallet.ts", "lib/feed/client.ts", "lib/feed/publish.ts"];
// The root entry of @x402/stellar re-exports the client scheme and the signer factory, so it is forbidden too.
const FORBIDDEN_PACKAGES = [/^ai$/, /^@ai-sdk\//, /^@x402\/stellar$/, /^@x402\/stellar\/exact\/client$/, /^@x402\/stellar\/exact\/facilitator$/, /^@x402\/fetch$/];

/**
 * Every package the check routes and lib/gateway use today. A new package, or a new entry point of an
 * existing one, fails the guard until a reviewer adds it here on purpose.
 */
const ALLOWED_PACKAGES = new Set([
  "@stellar/stellar-sdk",
  "@x402/core/server",
  "@x402/core/types",
  "@x402/next",
  "@x402/stellar/exact/server",
  "entities",
  "fs",
  "next/server",
  "node:crypto",
  "node:dns",
  "node:fs",
  "node:net",
  "node:path",
  "path",
  "smol-toml",
  "undici",
  "unpdf",
  "zod",
]);

describe("G1: the check routes reach no LLM, no signing key, and no x402 client code", () => {
  it("starts from both route files and follows imports into lib/gateway", () => {
    expect(checkRoots.sort()).toEqual(["app/api/check/detail/route.ts", "app/api/check/route.ts"]);
    expect(checkSet.has("lib/gateway/handlers.ts")).toBe(true);
    expect(checkSet.has("lib/gateway/paywall.ts")).toBe(true);
    expect(checkSet.has("lib/feed/reader.ts")).toBe(true);
  });

  it("reaches none of the LLM, wallet, publisher, or payer files", () => {
    for (const f of FORBIDDEN_FILES) expect(checkSet.has(f), f).toBe(false);
    expect([...checkSet].filter((f) => f.startsWith("agent/") || f.startsWith("lib/payer/"))).toEqual([]);
  });

  it("imports none of the LLM packages and none of the x402 client or facilitator entry points", () => {
    const packages = [...packageSpecifiers(checkSet, g)];
    expect(packages).toEqual(expect.arrayContaining(["@x402/next", "@x402/core/server", "@x402/stellar/exact/server"]));
    expect(packages.filter((p) => FORBIDDEN_PACKAGES.some((re) => re.test(p)))).toEqual([]);
  });

  it("uses only allowlisted packages, from the routes' whole import graph and from every lib/gateway file", () => {
    const gateway = files.filter((f) => f.startsWith("lib/gateway/") && !IS_TEST.test(f) && f !== "lib/gateway/testkit.ts");
    expect(gateway.length).toBeGreaterThan(8);
    for (const [name, set] of [["routes", checkSet], ["gateway", new Set(gateway)]] as const) {
      const unlisted = [...packageSpecifiers(set, g)].filter((p) => !ALLOWED_PACKAGES.has(p));
      expect(unlisted, name).toEqual([]);
    }
  });

  it("never mentions the signer factory, the agent key getter, or the agent secret", () => {
    const hits = [...checkSet].filter((f) => /createEd25519Signer|getAgentKeypair|AGENT_SECRET_KEY|\.agent-wallet/i.test(g.read(f)));
    expect(hits).toEqual([]);
  });

  it("nothing under agent/ or app/ (the chat and the wallet routes included) reaches the payer helpers, the paywall, or the paid deps", () => {
    // The MCP route has its own block (G4): it legitimately reaches the pure gateway files.
    const roots = files.filter((f) => /^(agent|app)\//.test(f) && !IS_TEST.test(f) && !f.startsWith("app/api/check/") && !f.startsWith("app/api/mcp/"));
    const set = reachable(roots, g);
    expect(roots).toContain("agent/tools.ts");
    expect([...set].filter((f) => f.startsWith("lib/payer/") || f.startsWith("lib/gateway/") || f.startsWith("lib/mcp/"))).toEqual([]);
    expect(set.has("scripts/paid-check.ts")).toBe(false);
  });

  it("the guard helper reports packages and ignores relative imports", () => {
    const mem: Graph = {
      index: new Map([["agent/a.ts", "agent/a.ts"]]),
      read: () => 'import x from "@x402/stellar/exact/client"; import y from "./b"; const z = await import("ai"); import fs from "node:fs";',
    };
    expect([...packageSpecifiers(["agent/a.ts"], mem)].sort()).toEqual(["@x402/stellar/exact/client", "ai", "node:fs"]);
  });
});

describe("packageSpecifiersOfSource cannot be fooled by strings or comments", () => {
  const BAD = "@x402/stellar/exact/client";

  it("sees an import after a string that contains two slashes", () => {
    expect(packageSpecifiersOfSource(`export const s = "a//b"; export const m = async () => import("${BAD}");`)).toEqual([BAD]);
  });

  it("sees an import after a glob string followed later by a block comment", () => {
    const src = ['const g = "data/status/*.json";', `const m = async () => import("${BAD}");`, "/** doc */", "export const x = 1;"].join("\n");
    expect(packageSpecifiersOfSource(src)).toEqual([BAD]);
  });

  it("sees static, dynamic, re-export, side-effect, and require forms, and skips relative and alias imports", () => {
    const src = [
      'import a from "pkg-a";',
      'import type { T } from "@scope/pkg-b/sub";',
      'export * from "pkg-c";',
      'import "pkg-d";',
      'const e = await import("pkg-e");',
      'const f = require("pkg-f");',
      'import r from "./local"; import p from "../up"; import al from "@/lib/x";',
    ].join("\n");
    expect(packageSpecifiersOfSource(src).sort()).toEqual(["@scope/pkg-b/sub", "pkg-a", "pkg-c", "pkg-d", "pkg-e", "pkg-f"]);
  });

  it("does not report prose in comments or strings that only look like imports", () => {
    const src = ['// import x from "not-a-package"', '/* import("also-not") */', 'const s = "import y from \'nor-this\'";'].join("\n");
    expect(packageSpecifiersOfSource(src)).toEqual([]);
  });
});

describe("G4: the MCP endpoint is free and read-only (golden rules 1, 7, 8, 11)", () => {
  const mcpRoots = files.filter((f) => f.startsWith("app/api/mcp/") && !IS_TEST.test(f));
  const mcpSet = reachable(mcpRoots, g);

  /** The packages the MCP route reaches today: the check routes' stored-file readers plus the MCP server library. */
  const MCP_ALLOWED_PACKAGES = new Set([
    "@modelcontextprotocol/server",
    "@stellar/stellar-sdk",
    "@x402/stellar/exact/server",
    "entities",
    "fs",
    "next/server",
    "node:crypto",
    "node:dns",
    "node:fs",
    "node:net",
    "node:path",
    "path",
    "smol-toml",
    "undici",
    "unpdf",
    "zod",
  ]);
  const MCP_FORBIDDEN_PACKAGES = [
    /^ai$/,
    /^@ai-sdk\//,
    /^@x402\/next$/,
    /^@x402\/core/,
    /^@x402\/stellar$/,
    /\/exact\/client$/,
    /\/exact\/facilitator$/,
    /^@x402\/fetch$/,
    /^@modelcontextprotocol\/sdk/,
    /^@modelcontextprotocol\/client/,
    /^@modelcontextprotocol\/node/,
    /^@modelcontextprotocol\/core/,
    /^@modelcontextprotocol\/server\//,
    /^mcp-handler$/,
  ];

  it("starts from the route and reaches the wrapper and the server", () => {
    expect(mcpRoots).toEqual(["app/api/mcp/route.ts"]);
    expect(mcpSet.has("lib/mcp/http.ts")).toBe(true);
    expect(mcpSet.has("lib/mcp/server.ts")).toBe(true);
  });

  it("reaches no paywall, paid deps, handlers, feed client, publisher, agent, payer, or script", () => {
    for (const f of ["handlers", "deps", "deps-paid", "detail", "paywall"]) expect(mcpSet.has(`lib/gateway/${f}.ts`), f).toBe(false);
    for (const f of ["reader", "client", "publish"]) expect(mcpSet.has(`lib/feed/${f}.ts`), f).toBe(false);
    expect([...mcpSet].filter((f) => f.startsWith("agent/") || f.startsWith("lib/payer/") || f.startsWith("scripts/"))).toEqual([]);
  });

  it("uses only allowlisted packages, and none of the forbidden ones", () => {
    const packages = [...packageSpecifiers(mcpSet, g)];
    expect(packages).toContain("@modelcontextprotocol/server");
    expect(packages.filter((p) => !MCP_ALLOWED_PACKAGES.has(p))).toEqual([]);
    expect(packages.filter((p) => MCP_FORBIDDEN_PACKAGES.some((re) => re.test(p)))).toEqual([]);
  });

  it("the only file that imports an x402 package is the payment configuration", () => {
    const hits = [...mcpSet].filter((f) => [...packageSpecifiers([f], g)].some((p) => p.startsWith("@x402/")));
    expect(hits).toEqual(["lib/gateway/payment-config.ts"]);
  });

  it("never mentions the signer factory, the agent key getter, or the agent secret", () => {
    const hits = [...mcpSet].filter((f) => /createEd25519Signer|getAgentKeypair|AGENT_SECRET_KEY|\.agent-wallet/i.test(g.read(f)));
    expect(hits).toEqual([]);
  });

  it("no lib/mcp file imports the check-route handlers, deps, detail, or paywall", () => {
    const mcpFiles = files.filter((f) => f.startsWith("lib/mcp/") && !IS_TEST.test(f));
    expect(mcpFiles.length).toBeGreaterThan(8);
    for (const f of mcpFiles) expect(g.read(f), f).not.toMatch(/gateway\/(handlers|deps|deps-paid|detail|paywall)["']/);
  });

  it("each MCP file imports directly only the MCP server library, the Stellar SDK, and zod, and no chain-read or feed file", () => {
    const own = files.filter((f) => (f.startsWith("lib/mcp/") || f.startsWith("app/api/mcp/")) && !IS_TEST.test(f));
    expect(own).toEqual(expect.arrayContaining(["lib/mcp/http.ts", "lib/mcp/server.ts", "lib/mcp/tools.ts", "app/api/mcp/route.ts"]));
    const directPackages = new Set(["@modelcontextprotocol/server", "@stellar/stellar-sdk", "zod"]);
    const forbiddenTargets = (target: string) =>
      target === "lib/chain/http.ts" || /^lib\/chain\/(horizon|toml|identity|asset)\.ts$/.test(target) || target.startsWith("lib/feed/");
    for (const f of own) {
      expect([...packageSpecifiers([f], g)].filter((p) => !directPackages.has(p)), f).toEqual([]);
      const targets = specifiers(g.read(f)).flatMap((spec) => {
        const t = resolve(spec, f, g);
        return t ? [t] : [];
      });
      expect(targets.filter(forbiddenTargets), f).toEqual([]);
    }
  });

  it("the MCP client library is a development dependency: only scripts and tests import it", () => {
    const offenders = files.filter(
      (f) => /^(app|agent|lib|components)\//.test(f) && !IS_TEST.test(f) && [...packageSpecifiers([f], g)].some((p) => p.startsWith("@modelcontextprotocol/client")),
    );
    expect(offenders).toEqual([]);
  });
});

describe("G2: the payer CLI and helpers never touch the agent wallet", () => {
  const payerFiles = [...files.filter((f) => f.startsWith("lib/payer/") && !IS_TEST.test(f)), "scripts/paid-check.ts"];

  it("covers the CLI and the helper files", () => {
    expect(payerFiles).toEqual(expect.arrayContaining(["scripts/paid-check.ts", "lib/payer/policy.ts", "lib/payer/confirm.ts"]));
  });

  it("mentions no agent key getter, agent secret, or wallet file", () => {
    for (const f of payerFiles) expect(g.read(f), f).not.toMatch(/getAgentKeypair|AGENT_SECRET_KEY|\.agent-wallet/i);
  });

  it("does not import anything from agent/", () => {
    const set = reachable(payerFiles, g);
    expect([...set].filter((f) => f.startsWith("agent/"))).toEqual([]);
  });
});

describe("G3: no price literal in the files that build the paid route (golden rule 7)", () => {
  const scanned = files.filter(
    (f) =>
      (f.startsWith("lib/gateway/") || f.startsWith("app/api/check/") || f.startsWith("lib/payer/") || f.startsWith("lib/mcp/") || f.startsWith("app/api/mcp/") || f === "scripts/paid-check.ts") &&
      f !== "lib/gateway/guard.test.ts",
  );
  const PRICE_PROPERTY = /\bprice\s*:\s*(["'`]|-?\d)/;
  const DOLLAR_STRING = /["'`]\$\d/;

  it("scans the gateway, the check routes, the MCP endpoint, the payer helpers, and the CLI", () => {
    expect(scanned.length).toBeGreaterThan(15);
    expect(scanned).toContain("lib/gateway/paywall.ts");
    expect(scanned).toContain("lib/mcp/http.ts");
    expect(scanned).toContain("app/api/mcp/route.ts");
  });

  it("finds no `price:` followed by a string or number literal, and no dollar-amount string", () => {
    for (const f of scanned) {
      const text = g.read(f);
      expect(text, f).not.toMatch(PRICE_PROPERTY);
      expect(text, f).not.toMatch(DOLLAR_STRING);
    }
  });

  it("the tripwire catches what it must", () => {
    // Samples are assembled from parts so this file holds no price or dollar-amount literal itself.
    const q = String.fromCharCode(0x22);
    const digit = String(1 + 1);
    expect(`price: ${q}${digit}${q}`).toMatch(PRICE_PROPERTY);
    expect(`price: ${digit}`).toMatch(PRICE_PROPERTY);
    expect("price: { asset: A, amount: config.amount }").not.toMatch(PRICE_PROPERTY);
    expect(`const p = ${q}${String.fromCharCode(0x24)}${digit}${q};`).toMatch(DOLLAR_STRING);
  });

  it(".env.example sets no value after any X402_ name", () => {
    const text = fs.readFileSync(path.join(ROOT, ".env.example"), "utf8");
    const lines = text.split("\n").filter((l) => /^\s*#?\s*X402_[A-Z_]+\s*=/.test(l));
    expect(lines.length).toBeGreaterThanOrEqual(5);
    for (const line of lines) expect(line.replace(/^\s*#?\s*/, ""), line).toMatch(/^X402_[A-Z_]+=\s*$/);
  });
});
