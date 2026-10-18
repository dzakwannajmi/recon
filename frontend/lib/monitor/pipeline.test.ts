import path from "path";
import { describe, expect, it } from "vitest";
import { recordingExec } from "./demo";
import { childEnv, ENV_NAMES, nodeExec, pipelineSteps, runPipeline } from "./pipeline";

const FRONTEND = "/repo/frontend";
const TSX = path.join(FRONTEND, "node_modules", ".bin", "tsx");

describe("P1: the pipeline", () => {
  it("has the exact steps, argv and timeouts", () => {
    expect(pipelineSteps("2026-10-17")).toEqual([
      { step: "check:assets", script: "scripts/check-assets.ts", args: ["--day", "2026-10-17"], timeoutMs: 600_000 },
      { step: "examine", script: "scripts/examine.ts", args: ["--day", "2026-10-17"], timeoutMs: 1_200_000 },
      { step: "status", script: "scripts/status.ts", args: ["--as-of", "2026-10-17"], timeoutMs: 120_000 },
    ]);
  });

  it("refuses a day that is not a real date, so nothing odd reaches an argument", () => {
    for (const bad of ["2026-02-30", "2026-10-17; rm -rf /", "--as-of", "", "2026-10-17\n"]) expect(() => pipelineSteps(bad), bad).toThrow(/invalid day/);
  });

  it("runs the three steps through the tsx binary in the frontend folder with only four environment names", () => {
    const { exec, calls } = recordingExec();
    const shown: string[] = [];
    const r = runPipeline("2026-10-17", {
      exec, frontendDir: FRONTEND, show: (t) => shown.push(t),
      env: { PATH: "/bin", HOME: "/h", TMPDIR: "/t", LANG: "C", AGENT_SECRET_KEY: "S...", NODE_OPTIONS: "--x", FEED_ADMIN_KEY: "k" },
    });
    expect(r.ok).toBe(true);
    expect(calls.map((c) => [c.file, ...c.args])).toEqual([
      [TSX, "scripts/check-assets.ts", "--day", "2026-10-17"], [TSX, "scripts/examine.ts", "--day", "2026-10-17"], [TSX, "scripts/status.ts", "--as-of", "2026-10-17"],
    ]);
    expect(calls.every((c) => c.cwd === FRONTEND)).toBe(true);
    expect(calls.map((c) => c.timeout)).toEqual([600_000, 1_200_000, 120_000]);
    for (const c of calls) expect(c.envKeys.sort()).toEqual([...ENV_NAMES].sort());
    expect(shown).toHaveLength(3);
  });

  it("childEnv keeps only PATH, HOME, TMPDIR, LANG", () => {
    expect(childEnv({ PATH: "p", HOME: "h", SECRET: "x", LANG: undefined })).toEqual({ PATH: "p", HOME: "h" });
  });

  it("stops at the first failed step", () => {
    const { exec, calls } = recordingExec({ "scripts/examine.ts": 4 });
    const r = runPipeline("2026-10-17", { exec, frontendDir: FRONTEND });
    expect(r.ok).toBe(false);
    expect(r.steps.map((s) => [s.step, s.exit_code])).toEqual([["check:assets", 0], ["examine", 4]]);
    expect(calls).toHaveLength(2);
  });

  it("nodeExec starts a process without a shell and with exactly the environment it is given", () => {
    const r = nodeExec(process.execPath, ["-e", "console.log(JSON.stringify(Object.keys(process.env).sort())); console.log('a;b $HOME `x`')"], {
      cwd: process.cwd(), timeout: 20_000, env: { PATH: process.env.PATH ?? "", LANG: "C" },
    });
    expect(r.exit_code).toBe(0);
    const [keys, text] = r.output.trim().split("\n");
    // a child gets the given names (the runtime may add a few of its own, but no secret name)
    expect(JSON.parse(keys)).toEqual(expect.arrayContaining(["LANG", "PATH"]));
    expect(JSON.parse(keys).filter((k: string) => /KEY|SECRET|TOKEN/i.test(k))).toEqual([]);
    expect(text).toBe("a;b $HOME `x`"); // the argument was not interpreted by a shell
  });

  it("nodeExec reports a non-zero exit with the child's output, and a timeout as a failure", () => {
    const fail = nodeExec(process.execPath, ["-e", "console.error('boom'); process.exit(7)"], { cwd: process.cwd(), timeout: 20_000, env: {} });
    expect(fail.exit_code).toBe(7);
    expect(fail.output).toContain("boom");
    const slow = nodeExec(process.execPath, ["-e", "setTimeout(() => {}, 5000)"], { cwd: process.cwd(), timeout: 200, env: {} });
    expect(slow.exit_code).not.toBe(0);
  });
});
