/**
 * Golden rule 1: the LLM proposes, code decides, and no LLM tool publishes.
 * Nothing the live chat can reach may import the feed modules or ask for the signing key.
 */
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SCANNED = ["agent", path.join("app", "api", "agent")];

function sourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : sourceFiles(p);
    return /\.(ts|tsx|mts|js|jsx|mjs)$/.test(e.name) ? [p] : [];
  });
}

/** True if the source imports, re-exports, requires, or dynamically imports a path through lib/feed. */
function importsFeed(source: string): boolean {
  return /(?:from\s*|import\s*\(\s*|import\s+|require\s*\(\s*)["'`][^"'`]*lib\/feed[\/"'`]/.test(source)
    || /(?:from\s*|import\s*\(\s*|import\s+|require\s*\(\s*)["'`][^"'`]*\/feed\/(?:client|encode|publish|verify|deployment)\b/.test(source);
}

describe("golden rule 1: no LLM-reachable module touches the feed", () => {
  const files = SCANNED.flatMap((d) => sourceFiles(path.join(ROOT, d)));

  it("scans the agent folder and the agent API route", () => {
    expect(files.length).toBeGreaterThan(5);
    expect(files.some((f) => f.endsWith(path.join("agent", "tools.ts")))).toBe(true);
  });

  it("no file under agent/ or app/api/agent imports lib/feed", () => {
    const offenders = files.filter((f) => importsFeed(fs.readFileSync(f, "utf8")));
    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
  });

  it("no file under agent/ or app/ except the wallet itself mentions the signing keypair getter", () => {
    const all = [...sourceFiles(path.join(ROOT, "agent")), ...sourceFiles(path.join(ROOT, "app"))];
    const offenders = all.filter((f) => !f.endsWith(path.join("agent", "wallet.ts")) && fs.readFileSync(f, "utf8").includes("getAgentKeypair"));
    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
  });

  it("the import matcher catches the shapes it must", () => {
    for (const bad of [
      'import { publishBatch } from "../lib/feed/client";',
      "import { x } from '@/lib/feed/encode';",
      'export * from "../lib/feed/publish"',
      'const m = await import("../lib/feed/client");',
      'const m = require("../../lib/feed/client")',
      'import "../lib/feed/verify";',
      'import { x } from "./feed/client";',
    ]) expect(importsFeed(bad), bad).toBe(true);
    for (const fine of [
      'import { assetStatus } from "../lib/flags/status";',
      'import { loadUniverse } from "../lib/chain/universe";',
      "// the feed publishes elsewhere: lib/feed is not imported here",
    ]) expect(importsFeed(fine), fine).toBe(false);
  });
});
