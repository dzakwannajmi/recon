/**
 * The re-check pipeline (D-047, spec 4.9): the existing deterministic scripts, run in order, stopping at
 * the first failure. This is the only Monitor file that starts a process. Fixed argv, no shell, a
 * validated date, and four environment names; no key or token is in reach. Child output goes to the
 * operator's terminal and never into the log.
 *
 * Document snapshots, claim extraction, review import, and feed publishing are never run from here.
 */
import { execFileSync } from "node:child_process";
import path from "path";
import { isIsoDay } from "../flags/types";

export type StepSpec = { step: string; script: string; args: string[]; timeoutMs: number };

export type ExecOptions = { cwd: string; timeout: number; env: Record<string, string> };
export type ExecResult = { exit_code: number; ms: number; output: string };
/** Run one process; returns instead of throwing on a non-zero exit. */
export type Exec = (file: string, args: string[], opts: ExecOptions) => ExecResult;

const MIN = 60_000;
export const ENV_NAMES = ["PATH", "HOME", "TMPDIR", "LANG"] as const;

export function pipelineSteps(day: string): StepSpec[] {
  if (!isIsoDay(day)) throw new Error(`refusing to run the pipeline for an invalid day: ${day}`);
  return [
    { step: "check:assets", script: "scripts/check-assets.ts", args: [], timeoutMs: 10 * MIN },
    { step: "examine", script: "scripts/examine.ts", args: [], timeoutMs: 20 * MIN },
    { step: "status", script: "scripts/status.ts", args: ["--as-of", day], timeoutMs: 2 * MIN },
  ];
}

/** The only environment a child gets. */
export function childEnv(source: Record<string, string | undefined> = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of ENV_NAMES) {
    const v = source[name];
    if (typeof v === "string") env[name] = v;
  }
  return env;
}

/** The real executor: execFileSync with stdout and stderr captured, so the caller can show them. */
export const nodeExec: Exec = (file, args, opts) => {
  const started = Date.now();
  const text = (b: unknown) => (Buffer.isBuffer(b) ? b.toString("utf8") : typeof b === "string" ? b : "");
  try {
    const out = execFileSync(file, args, {
      cwd: opts.cwd, shell: false, stdio: ["ignore", "pipe", "pipe"], timeout: opts.timeout, env: opts.env as NodeJS.ProcessEnv, maxBuffer: 64 * 1024 * 1024,
    });
    return { exit_code: 0, ms: Date.now() - started, output: text(out) };
  } catch (err) {
    const e = err as { status?: number | null; stdout?: unknown; stderr?: unknown; message?: string };
    return { exit_code: typeof e.status === "number" ? e.status : 1, ms: Date.now() - started, output: text(e.stdout) + text(e.stderr) || (e.message ?? "") };
  }
};

export type PipelineResult = { ok: boolean; steps: { step: string; exit_code: number; ms: number }[] };

/**
 * @param frontendDir the `frontend/` folder: the working directory and the home of node_modules/.bin/tsx
 * @param show receives each step's output for the operator's terminal
 */
export function runPipeline(day: string, deps: { exec?: Exec; frontendDir: string; show?: (text: string) => void; env?: Record<string, string | undefined> }): PipelineResult {
  const exec = deps.exec ?? nodeExec;
  const tsx = path.join(deps.frontendDir, "node_modules", ".bin", "tsx");
  const steps: PipelineResult["steps"] = [];
  for (const s of pipelineSteps(day)) {
    const r = exec(tsx, [s.script, ...s.args], { cwd: deps.frontendDir, timeout: s.timeoutMs, env: childEnv(deps.env) });
    if (r.output) deps.show?.(r.output);
    steps.push({ step: s.step, exit_code: r.exit_code, ms: r.ms });
    if (r.exit_code !== 0) return { ok: false, steps };
  }
  return { ok: true, steps };
}
