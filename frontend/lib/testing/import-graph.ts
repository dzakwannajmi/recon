/**
 * Import-graph helpers for the guard tests (lib/feed/guard.test.ts, lib/gateway/guard.test.ts).
 * Test support only: nothing in the app imports this file.
 */
import fs from "fs";
import path from "path";
import ts from "typescript";

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
  for (const file of files) for (const spec of packageSpecifiersOfSource(g.read(file))) out.add(spec);
  return out;
}

/**
 * The package specifiers of one source text. It uses the TypeScript scanner (`ts.preProcessFile`), which
 * understands strings, comments, template literals, `import ... from`, `export ... from`, `import()` and
 * `require()`. Stripping comments with a regex is not safe: a string like "a//b" or a glob like "x/*.json"
 * can hide a real import. Relative and `@/` imports are left out.
 */
export function packageSpecifiersOfSource(source: string): string[] {
  const info = ts.preProcessFile(source, true, true);
  return info.importedFiles.map((f) => f.fileName).filter((spec) => !spec.startsWith("./") && !spec.startsWith("../") && !spec.startsWith("@/") && spec !== "." && spec !== "..");
}

/**
 * Text that loads a signing key: the secret env name, the signing getter, the SDK functions that build a
 * keypair from secret material, and any read of a `secret` field (`x.secret`, `x["secret"]`, `{ secret } =`).
 * Calling `.secret()` on a freshly generated keypair to write it once (agent/wallet.ts `createWallet`) is
 * not a read, so it does not match.
 */
export const SECRET_READ_PATTERNS: readonly { name: string; re: RegExp }[] = [
  { name: "AGENT_SECRET_KEY", re: /AGENT_SECRET_KEY/i },
  { name: "getAgentKeypair", re: /getAgentKeypair/i },
  { name: "Keypair.fromSecret", re: /fromSecret|fromRawEd25519Seed|decodeEd25519SecretSeed/i },
  { name: "secret field (dot)", re: /\.secret\b(?!\s*\()/ },
  { name: "secret field (index)", re: /\[\s*["'`]secret["'`]\s*\]/ },
  { name: "secret field (destructuring)", re: /\{[^{}]*\bsecret\b[^{}]*\}\s*=(?![=>])/ },
];

/** The files that contain secret-loading text, each with the first pattern name it matches. */
export function secretReaders(files: Iterable<string>, g: Graph): string[] {
  const out: string[] = [];
  for (const f of files) {
    const hit = SECRET_READ_PATTERNS.find((p) => p.re.test(g.read(f)));
    if (hit) out.push(`${f}: ${hit.name}`);
  }
  return out;
}

/**
 * Files allowed a computed `process.env[name]` lookup. Each one passes only constant names (checked by
 * grep on 2026-10-15 and by a guard test): `positiveInt("…")` callers, the LLM key names in agent/llm.ts
 * `KEY_ENV`, and the redaction list in lib/llm-errors.ts. A new entry needs a reviewer.
 */
export const ENV_INDEX_ALLOWLIST: ReadonlySet<string> = new Set(["lib/env.ts", "agent/llm.ts", "lib/llm-errors.ts"]);

/**
 * Text that can reach an env variable by a name the text check cannot see: a computed lookup, enumeration,
 * or a spread copy of the whole environment. A computed lookup is allowed only in ENV_INDEX_ALLOWLIST.
 */
export const ENV_ENUMERATION_PATTERNS: readonly { name: string; re: RegExp; allowlisted: boolean }[] = [
  { name: "computed process.env[...]", re: /\bprocess\.env\s*(?:\?\.\s*)?\[/, allowlisted: true },
  { name: "Object.keys/values/entries(process.env)", re: /\bObject\s*\.\s*(?:keys|values|entries)\s*\(\s*process\.env\b/, allowlisted: false },
  { name: "...process.env", re: /\.\.\.\s*process\.env\b/, allowlisted: false },
];

/** The files that enumerate the environment or index it by a computed name outside the allowlist. */
export function envEnumerators(files: Iterable<string>, g: Graph, allow: ReadonlySet<string> = ENV_INDEX_ALLOWLIST): string[] {
  const out: string[] = [];
  for (const f of files) {
    const text = g.read(f);
    const hit = ENV_ENUMERATION_PATTERNS.find((p) => p.re.test(text) && !(p.allowlisted && allow.has(f.toLowerCase())));
    if (hit) out.push(`${f}: ${hit.name}`);
  }
  return out;
}

export const realGraph = (): Graph => {
  const files = ["agent", "app", "lib", "components", "scripts"].flatMap((d) => listSources(path.join(ROOT, d)).map((f) => `${d}/${f}`));
  return { index: new Map(files.map((f) => [f.toLowerCase(), f])), read: (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8") };
};
