/**
 * Import-graph helpers for the guard tests (lib/feed/guard.test.ts, lib/gateway/guard.test.ts).
 * Test support only: nothing in the app imports this file.
 */
import fs from "fs";
import path from "path";

export const ROOT = process.cwd();
export const EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "out", ".git"]);
export const IS_TEST = /\.(test|spec)\.[cm]?[jt]sx?$/;

/** Every source file under a folder, as posix paths relative to ROOT. */
export function listSources(dir: string, rel = ""): string[] {
  const abs = path.join(dir, rel);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) return SKIP_DIRS.has(e.name) ? [] : listSources(dir, r);
    return EXTENSIONS.some((x) => e.name.endsWith(x)) ? [r] : [];
  });
}

/** Module specifiers: import/export ... from, bare import, import(), require(). */
export function specifiers(source: string): string[] {
  const out: string[] = [];
  const re = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)(["'`])([^"'`\n]+)\1/g;
  for (const m of source.matchAll(re)) out.push(m[2]);
  return out;
}

export type Graph = {
  /** lower-case relative path -> real relative path (so `../Lib/Feed/Client` resolves like it does on a case-insensitive disk) */
  index: Map<string, string>;
  read: (rel: string) => string;
};

export function resolve(spec: string, fromRel: string, g: Graph): string | null {
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
export function reachable(roots: string[], g: Graph): Set<string> {
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

/**
 * The package specifiers (not relative, not `@/`) that the given files import, e.g. `@x402/next` or `@x402/stellar/exact/client`.
 * Specifiers that resolve to a source file are not packages and are left out.
 */
export function packageSpecifiers(files: Iterable<string>, g: Graph): Set<string> {
  const out = new Set<string>();
  for (const file of files) {
    for (const spec of specifiers(g.read(file))) {
      if (spec.startsWith("./") || spec.startsWith("../") || spec.startsWith("@/")) continue;
      out.add(spec);
    }
  }
  return out;
}

export const realGraph = (): Graph => {
  const files = ["agent", "app", "lib", "components", "scripts"].flatMap((d) => listSources(path.join(ROOT, d)).map((f) => `${d}/${f}`));
  return { index: new Map(files.map((f) => [f.toLowerCase(), f])), read: (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8") };
};
