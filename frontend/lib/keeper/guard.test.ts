/**
 * Golden rules 1 and 8 for the keeper (D-045, spec 6.3): the app never reaches the keeper, and the keeper
 * reaches no signer, publisher, payer, LLM or secret. Signing is stellar-cli only (`cli-signer.ts`), so no
 * secret key can enter Node. Reuses lib/testing/import-graph.ts and follows the style of lib/feed/guard.test.ts.
 */
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { IS_TEST, ROOT, packageSpecifiers, reachable, realGraph, resolve, secretReaders, specifiers, type Graph } from "../testing/import-graph";

const KEEPER_SCRIPTS = ["scripts/keeper.ts", "scripts/keeper-demo.ts"];
const CLI_SIGNER = "lib/keeper/cli-signer.ts";
const isKeeperFile = (f: string) => f.toLowerCase().startsWith("lib/keeper/") || /^scripts\/keeper[^/]*\.ts$/i.test(f);

/** Starts a process: node:child_process, the exec/spawn/fork family (a `.exec(` method call on a RegExp is not one). */
const SPAWN_PATTERN = /\bchild_process\b|\bexecFile(?:Sync)?\b|\bexecSync\b|\bspawn(?:Sync)?\b|\bfork\s*\(|(?<![.\w])exec\s*\(/;
/** A quoted "secret" literal: the keeper never asks stellar-cli for a secret. */
const QUOTED_SECRET = /["'`]secret["'`]/i;
const FORBIDDEN_PACKAGES = /^(ai|@ai-sdk\/.+|@x402\/.+|@modelcontextprotocol\/.+)$/;
const spawners = (files: Iterable<string>, g: Graph) => [...files].filter((f) => SPAWN_PATTERN.test(g.read(f)));
const quotedSecrets = (files: Iterable<string>, g: Graph) => [...files].filter((f) => QUOTED_SECRET.test(g.read(f)));
const forbiddenPackages = (files: Iterable<string>, g: Graph) => [...packageSpecifiers(files, g)].filter((p) => FORBIDDEN_PACKAGES.test(p));

describe("G1: nothing under app/ or agent/ reaches the keeper", () => {
  const g = realGraph();
  const roots = [...g.index.values()].filter((f) => /^(agent|app)\//.test(f) && !IS_TEST.test(f));
  const set = reachable(roots, g);

  it("starts from every non-test file under agent/ and app/ (the signer included) and follows imports", () => {
    expect(roots.length).toBeGreaterThanOrEqual(8);
    expect(roots).toContain("agent/tools.ts");
    expect(roots).toContain("agent/signer.ts");
    expect(set.size).toBeGreaterThan(roots.length);
  });

  it("reaches no file of lib/keeper/ and neither keeper script", () => {
    expect([...set].filter(isKeeperFile)).toEqual([]);
  });

  it("the keeper files and scripts exist, so the check above is not empty", () => {
    for (const f of [...KEEPER_SCRIPTS, CLI_SIGNER, "lib/keeper/run.ts", "lib/keeper/demo.ts", "lib/keeper/send.ts", "lib/keeper/market.ts", "lib/keeper/records.ts", "lib/keeper/log.ts"]) {
      expect(g.index.has(f.toLowerCase()), f).toBe(true);
    }
  });
});

describe("the keeper's own reach", () => {
  const g = realGraph();
  const set = reachable(KEEPER_SCRIPTS, g);

  it("starts from both scripts and reaches its modules", () => {
    expect(set.has("scripts/keeper.ts")).toBe(true);
    expect(set.has("scripts/keeper-demo.ts")).toBe(true);
    for (const f of ["lib/keeper/run.ts", "lib/keeper/demo.ts", "lib/keeper/send.ts", CLI_SIGNER, "lib/keeper/market.ts", "lib/keeper/records.ts", "lib/keeper/log.ts", "lib/feed/reader.ts", "lib/feed/encode.ts"]) {
      expect(set.has(f), f).toBe(true);
    }
  });

  it("G2: reaches no signer, wallet, LLM or tool module, no feed client or publisher, and no payer file but env.ts", () => {
    for (const f of ["agent/signer.ts", "agent/wallet.ts", "agent/llm.ts", "agent/tools.ts", "lib/feed/client.ts", "lib/feed/publish.ts"]) {
      expect(set.has(f), f).toBe(false);
    }
    expect([...set].filter((f) => f.startsWith("lib/payer/") && f !== "lib/payer/env.ts")).toEqual([]);
    expect(set.has("lib/payer/env.ts")).toBe(true);
    expect([...set].filter((f) => f.startsWith("agent/"))).toEqual([]);
    expect([...set].filter((f) => f.startsWith("app/"))).toEqual([]);
  });

  it("G3: loads no secret: no secret reader, and no quoted \"secret\" literal", () => {
    expect(secretReaders(set, g)).toEqual([]);
    expect(quotedSecrets(set, g)).toEqual([]);
  });

  it("G4: imports no LLM SDK, x402, or MCP package (golden rule 1: no LLM in the keeper)", () => {
    expect(forbiddenPackages(set, g)).toEqual([]);
    const all = [...packageSpecifiers(set, g)];
    expect(all).toContain("@stellar/stellar-sdk");
    expect(all).toContain("zod");
  });

  it("G5: cli-signer.ts is the only file that starts a process", () => {
    expect(spawners(set, g)).toEqual([CLI_SIGNER]);
    expect(g.read(CLI_SIGNER)).toMatch(/execFileSync\(\s*"stellar"/);
  });

  it("G5 (support): the signer passes no shell and takes the identity name only from the checked pattern", () => {
    const src = g.read(CLI_SIGNER);
    expect(src).toMatch(/shell:\s*false/);
    expect(src).toContain('"--sign-with-key"');
    expect(src).toMatch(/\^\[a-z0-9\]\[a-z0-9-\]\{0,31\}\$/);
    expect(src).not.toMatch(/\bsh\b\s*-c|bash|zsh|cmd\.exe/);
  });

  it("nothing the keeper reaches mentions the agent wallet file, the secret env name, the key getter, dotenv or an env file", () => {
    for (const f of set) {
      const text = g.read(f);
      expect(text, f).not.toMatch(/agent-wallet|AGENT_SECRET_KEY|getAgentKeypair|dotenv|--env-file|(?<![\w])\.env(?![\w.[])/);
    }
  });
});

describe("G6: the keeper scripts do not load .env", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };
  const keeperScripts = Object.entries(pkg.scripts).filter(([name]) => name.startsWith("keeper:"));

  it("keeper:run and keeper:demo exist and run tsx on their script alone", () => {
    expect(Object.fromEntries(keeperScripts)).toEqual({ "keeper:run": "tsx scripts/keeper.ts", "keeper:demo": "tsx scripts/keeper-demo.ts" });
  });

  it("no keeper:* script has --env-file (or --env-file-if-exists) or mentions .env", () => {
    for (const [name, cmd] of keeperScripts) {
      expect(cmd, name).not.toMatch(/--env-file/);
      expect(cmd, name).not.toMatch(/\.env/);
    }
  });

  it("the keeper's own files name no environment variable (FEED_RPC_URL and FEED_RPC_ALLOW_HOSTS are read inside feedRpcUrl), and nothing it reaches reads a key, secret or token variable", () => {
    const g = realGraph();
    const set = reachable(KEEPER_SCRIPTS, g);
    const namesIn = (files: Iterable<string>) => {
      const names = new Set<string>();
      for (const f of files) for (const m of g.read(f).matchAll(/process\.env\.([A-Za-z0-9_]+)/g)) names.add(m[1]);
      return [...names].sort();
    };
    expect(namesIn([...set].filter(isKeeperFile))).toEqual([]);
    // Reached through lib/feed/encode.ts and lib/chain/universe.ts: path settings with defaults (snapshot folder, assets file).
    expect(namesIn(set)).toEqual(["ASSETS_CSV", "SNAPSHOTS_DIR"].filter((n) => namesIn(set).includes(n)));
    expect(namesIn(set).filter((n) => /KEY|SECRET|TOKEN|PASSWORD|MNEMONIC/i.test(n))).toEqual([]);
  });
});

describe("G7: the feed guard still holds", () => {
  const g = realGraph();

  it("agent/signer.ts is imported only by scripts/publish-feed.ts, so no keeper file imports it", () => {
    const importers = [...g.index.values()].filter(
      (f) => !IS_TEST.test(f) && specifiers(g.read(f)).some((spec) => resolve(spec, f, g) === "agent/signer.ts"),
    );
    expect(importers).toEqual(["scripts/publish-feed.ts"]);
    expect(importers.filter(isKeeperFile)).toEqual([]);
  });

  it("lib/feed/guard.test.ts is present with its signer rule (it runs in the same suite and must stay green and unedited)", () => {
    const text = fs.readFileSync(path.join(ROOT, "lib/feed/guard.test.ts"), "utf8");
    expect(text).toContain("agent/signer.ts is imported only by scripts/publish-feed.ts");
    expect(text).toContain("expect(importers).toEqual([\"scripts/publish-feed.ts\"])");
  });
});

describe("the guard itself catches what it must (in-memory graph)", () => {
  const graph = (files: Record<string, string>): Graph => ({
    index: new Map(Object.keys(files).map((f) => [f.toLowerCase(), f])),
    read: (rel) => files[rel],
  });

  it("G1: finds the keeper through a helper chain from app/ or agent/", () => {
    const g = graph({
      "app/api/x/route.ts": 'import { h } from "@/lib/helpers";',
      "lib/helpers.ts": 'export * from "./keeper/run";',
      "lib/keeper/run.ts": "",
      "agent/tools.ts": 'import "../scripts/keeper";',
      "scripts/keeper.ts": "",
    });
    const set = reachable(["app/api/x/route.ts", "agent/tools.ts"], g);
    expect([...set].filter(isKeeperFile).sort()).toEqual(["lib/keeper/run.ts", "scripts/keeper.ts"]);
    expect(isKeeperFile("scripts/keeper-demo.ts")).toBe(true);
    expect(isKeeperFile("scripts/publish-feed.ts")).toBe(false);
  });

  it("G5: sees every way of starting a process and ignores RegExp.exec", () => {
    const bad = [
      'import { execFileSync } from "node:child_process";',
      'import cp from "child_process"; cp.spawn("x");',
      'const { spawnSync } = require("node:child_process");',
      "execSync(cmd)",
      "exec(cmd)",
      "child.fork(file)",
    ];
    for (const src of bad) expect(spawners(["lib/keeper/a.ts"], graph({ "lib/keeper/a.ts": src })), src).toHaveLength(1);
    const ok = ["const m = /x/.exec(text);", "const m = re.exec(text);", "const execution = 1;", "// starts nothing"];
    for (const src of ok) expect(spawners(["lib/keeper/a.ts"], graph({ "lib/keeper/a.ts": src })), src).toEqual([]);
  });

  it("G3: sees a quoted secret literal and a secret-field read, and not a plain word", () => {
    for (const src of ['run(["keys", "secret", id]);', "run(['keys', 'secret'])", "const a = `secret`;", 'const s = data["secret"];', "const s = file.secret;"]) {
      const g = graph({ "lib/keeper/a.ts": src });
      expect(quotedSecrets(["lib/keeper/a.ts"], g).length + secretReaders(["lib/keeper/a.ts"], g).length, src).toBeGreaterThan(0);
    }
    const g = graph({ "lib/keeper/a.ts": "// no secret enters Node\nconst secretly = 1;" });
    expect(quotedSecrets(["lib/keeper/a.ts"], g)).toEqual([]);
    expect(secretReaders(["lib/keeper/a.ts"], g)).toEqual([]);
  });

  it("G4: sees an LLM, x402 or MCP package, including a subpath, and not a stellar package", () => {
    for (const spec of ["ai", "@ai-sdk/google", "@x402/stellar/exact/client", "@modelcontextprotocol/server"]) {
      const g = graph({ "lib/keeper/a.ts": `import x from "${spec}";` });
      expect(forbiddenPackages(["lib/keeper/a.ts"], g), spec).toEqual([spec]);
    }
    const ok = graph({ "lib/keeper/a.ts": 'import { Keypair } from "@stellar/stellar-sdk"; import { z } from "zod"; import "./b";', "lib/keeper/b.ts": "" });
    expect(forbiddenPackages(["lib/keeper/a.ts"], ok)).toEqual([]);
  });

  it("G2: follows a payer or signer import through an intermediate file", () => {
    const g = graph({
      "scripts/keeper.ts": 'import "../lib/keeper/wire";',
      "lib/keeper/wire.ts": 'import "../payer/safe";',
      "lib/payer/safe.ts": 'import "../../agent/signer";',
      "agent/signer.ts": "",
    });
    const set = reachable(["scripts/keeper.ts"], g);
    expect(set.has("lib/payer/safe.ts")).toBe(true);
    expect(set.has("agent/signer.ts")).toBe(true);
  });
});
