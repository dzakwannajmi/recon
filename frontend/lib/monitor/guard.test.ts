/**
 * Golden rules 1, 8 and 11 for the Monitor (D-047, spec 6.3): the app never reaches it, and it reaches no
 * model, signer, payer, publisher or secret. The only process it starts is the fixed pipeline, in pipeline.ts.
 * Reuses lib/testing/import-graph.ts and follows the style of lib/keeper/guard.test.ts.
 */
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { IS_TEST, ROOT, packageSpecifiers, reachable, realGraph, secretReaders, envEnumerators, type Graph } from "../testing/import-graph";

const SCRIPTS = ["scripts/monitor.ts", "scripts/monitor-demo.ts"];
const PIPELINE = "lib/monitor/pipeline.ts";
const isMonitorFile = (f: string) => f.toLowerCase().startsWith("lib/monitor/") || /^scripts\/monitor[^/]*\.ts$/i.test(f);

const SPAWN_PATTERN = /\bchild_process\b|\bexecFile(?:Sync)?\b|\bexecSync\b|\bspawn(?:Sync)?\b|\bfork\s*\(|(?<![.\w])exec\s*\(/;
const QUOTED_SECRET = /["'`]secret["'`]/i;
const FORBIDDEN_PACKAGES = /^(ai|@ai-sdk\/.+|@x402\/.+|@modelcontextprotocol\/.+)$/;
/** An env file path or flag. */
const ENV_FILE = /--env-file|(?<![\w])\.env(?![\w[])|dotenv/;

const spawners = (files: Iterable<string>, g: Graph) => [...files].filter((f) => SPAWN_PATTERN.test(g.read(f)));

describe("G1: nothing under app/ or agent/ reaches the Monitor", () => {
  const g = realGraph();
  const roots = [...g.index.values()].filter((f) => /^(agent|app)\//.test(f) && !IS_TEST.test(f));
  const set = reachable(roots, g);

  it("starts from every non-test file under agent/ and app/ and follows imports", () => {
    expect(roots.length).toBeGreaterThanOrEqual(8);
    expect(set.size).toBeGreaterThan(roots.length);
  });

  it("reaches no file of lib/monitor/, neither monitor script, and not the status run that reads the issuance file", () => {
    expect([...set].filter(isMonitorFile)).toEqual([]);
    expect(set.has("lib/flags/run.ts")).toBe(false);
    expect(set.has("scripts/status.ts")).toBe(false);
  });

  it("the Monitor files and scripts exist, so the check above is not empty", () => {
    for (const f of [...SCRIPTS, PIPELINE, "lib/monitor/run.ts", "lib/monitor/horizon.ts", "lib/monitor/classify.ts", "lib/monitor/reconcile.ts", "lib/monitor/cadence.ts", "lib/monitor/frozen.ts", "lib/monitor/demo.ts"]) {
      expect(g.index.has(f.toLowerCase()), f).toBe(true);
    }
  });
});

describe("the Monitor's own reach", () => {
  const g = realGraph();
  const set = reachable(SCRIPTS, g);

  it("starts from both scripts and reaches its modules", () => {
    for (const f of ["lib/monitor/run.ts", PIPELINE, "lib/monitor/horizon.ts", "lib/monitor/frozen.ts", "lib/monitor/demo.ts"]) expect(set.has(f), f).toBe(true);
  });

  it("G2: reaches no LLM, signer, wallet or tool module, no feed client or publisher, no keeper, and no payer file", () => {
    for (const f of ["agent/signer.ts", "agent/wallet.ts", "agent/llm.ts", "agent/tools.ts", "lib/feed/client.ts", "lib/feed/publish.ts"]) expect(set.has(f), f).toBe(false);
    expect([...set].filter((f) => f.startsWith("lib/payer/"))).toEqual([]);
    expect([...set].filter((f) => f.startsWith("lib/keeper/"))).toEqual([]);
    expect([...set].filter((f) => f.startsWith("agent/") || f.startsWith("app/"))).toEqual([]);
  });

  it("G3: imports no LLM SDK, x402, or MCP package (golden rules 1 and 11: no model, zero LLM tokens)", () => {
    const pkgs = [...packageSpecifiers(set, g)];
    expect(pkgs.filter((p) => FORBIDDEN_PACKAGES.test(p))).toEqual([]);
    expect(pkgs).toContain("zod");
  });

  it("G4: pipeline.ts is the only file in the set that starts a process, with a fixed argv and no shell", () => {
    expect(spawners(set, g)).toEqual([PIPELINE]);
    const src = g.read(PIPELINE);
    expect(src).toMatch(/execFileSync\(\s*file/);
    expect(src).toMatch(/shell:\s*false/);
    expect(src).not.toMatch(/\bsh\b\s*-c|bash|zsh|cmd\.exe/);
    for (const banned of ["snapshot:docs", "extract:claims", "import:review", "feed:publish", "publish-feed", "snapshot-docs", "extract-claims", "import-review"]) {
      expect(src, banned).not.toContain(banned);
    }
    // the steps are exactly the three deterministic scripts
    expect([...src.matchAll(/script: "(scripts\/[a-z-]+\.ts)"/g)].map((m) => m[1])).toEqual(["scripts/check-assets.ts", "scripts/examine.ts", "scripts/status.ts"]);
  });

  it("G5: no env file path, --env-file, quoted secret literal or secret reader anywhere in the set", () => {
    expect(secretReaders(set, g)).toEqual([]);
    for (const f of set) {
      const text = g.read(f);
      expect(QUOTED_SECRET.test(text), `${f}: quoted secret`).toBe(false);
      expect(ENV_FILE.test(text), `${f}: env file`).toBe(false);
      expect(/agent-wallet|AGENT_SECRET_KEY|getAgentKeypair/.test(text), `${f}: wallet`).toBe(false);
    }
  });

  it("G5: the Monitor's own files read exactly four environment names, through lib/env.ts, and enumerate no environment", () => {
    const own = [...set].filter(isMonitorFile);
    expect(envEnumerators(own, g)).toEqual([]);
    const names = new Set<string>();
    for (const f of own) for (const m of g.read(f).matchAll(/positiveInt\(\s*"([A-Z0-9_]+)"/g)) names.add(m[1]);
    expect([...names].sort()).toEqual(["MONITOR_MAX_PAGES_PER_ISSUER", "MONITOR_MAX_REQUESTS", "MONITOR_MAX_RUNS_PER_DAY", "MONITOR_MIN_GAP_MINUTES"]);
    for (const f of own) expect(g.read(f), f).not.toMatch(/process\.env\.[A-Z]/);
  });

  it("makes no write to any network: no signing, no transaction building, no submit", () => {
    for (const f of set) expect(g.read(f), f).not.toMatch(/TransactionBuilder|\.submitTransaction|sendTransaction|signTransaction|Keypair\./);
  });
});

describe("G5: the monitor npm scripts load no environment file", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };
  it("monitor and monitor:demo exist and run tsx on their script alone", () => {
    const monitor = Object.fromEntries(Object.entries(pkg.scripts).filter(([n]) => n.startsWith("monitor")));
    expect(monitor).toEqual({ monitor: "tsx scripts/monitor.ts", "monitor:demo": "tsx scripts/monitor-demo.ts" });
    for (const cmd of Object.values(monitor)) expect(cmd).not.toMatch(/--env-file|\.env/);
  });
});

describe("G6: the feed and keeper guards are unchanged and present", () => {
  for (const f of ["lib/feed/guard.test.ts", "lib/keeper/guard.test.ts"]) {
    it(`${f} exists with its signer rule`, () => {
      const text = fs.readFileSync(path.join(ROOT, f), "utf8");
      expect(text).toContain("agent/signer.ts");
    });
  }
});

describe("the guard itself catches what it must (in-memory graph)", () => {
  const graph = (files: Record<string, string>): Graph => ({ index: new Map(Object.keys(files).map((f) => [f.toLowerCase(), f])), read: (rel) => files[rel] });

  it("G1: finds the Monitor through a helper chain from app/", () => {
    const g = graph({ "app/api/x/route.ts": 'import "@/lib/helpers";', "lib/helpers.ts": 'export * from "./monitor/run";', "lib/monitor/run.ts": "" });
    expect([...reachable(["app/api/x/route.ts"], g)].filter(isMonitorFile)).toEqual(["lib/monitor/run.ts"]);
    expect(isMonitorFile("scripts/monitor-demo.ts")).toBe(true);
    expect(isMonitorFile("scripts/status.ts")).toBe(false);
  });

  it("G4: sees a second process starter besides pipeline.ts", () => {
    const g = graph({ "lib/monitor/pipeline.ts": 'import { execFileSync } from "node:child_process";', "lib/monitor/x.ts": "spawnSync(a)" });
    expect(spawners(["lib/monitor/pipeline.ts", "lib/monitor/x.ts"], g)).toEqual(["lib/monitor/pipeline.ts", "lib/monitor/x.ts"]);
  });

  it("G5: sees an env file flag and a dotenv import", () => {
    for (const src of ["tsx --env-file=.env x", 'import "dotenv/config"', 'readFile(".env.local")']) expect(ENV_FILE.test(src), src).toBe(true);
    expect(ENV_FILE.test("process.env[name]")).toBe(false);
  });
});
