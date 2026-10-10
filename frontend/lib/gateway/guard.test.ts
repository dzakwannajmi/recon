/**
 * Golden rules 1, 6, 7, and 8 for the check routes.
 *  - G1: no LLM, no signing key, and no x402 client code is reachable from app/api/check/**,
 *        and nothing under agent/ or app/ reaches the payer helpers or the paywall.
 *  - G2: the payer CLI and its helpers never touch the agent wallet.
 *  - G3: a tripwire for revenue (rule 7): no price literal in the files that build the paid route.
 */
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { IS_TEST, ROOT, packageSpecifiers, reachable, realGraph, type Graph } from "../testing/import-graph";

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
    const roots = files.filter((f) => /^(agent|app)\//.test(f) && !IS_TEST.test(f) && !f.startsWith("app/api/check/"));
    const set = reachable(roots, g);
    expect(roots).toContain("agent/tools.ts");
    expect([...set].filter((f) => f.startsWith("lib/payer/") || f.startsWith("lib/gateway/"))).toEqual([]);
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
      (f.startsWith("lib/gateway/") || f.startsWith("app/api/check/") || f.startsWith("lib/payer/") || f === "scripts/paid-check.ts") &&
      f !== "lib/gateway/guard.test.ts",
  );
  const PRICE_PROPERTY = /\bprice\s*:\s*(["'`]|-?\d)/;
  const DOLLAR_STRING = /["'`]\$\d/;

  it("scans the gateway, the check routes, the payer helpers, and the CLI", () => {
    expect(scanned.length).toBeGreaterThan(15);
    expect(scanned).toContain("lib/gateway/paywall.ts");
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
