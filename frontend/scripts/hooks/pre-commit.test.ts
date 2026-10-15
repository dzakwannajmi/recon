/**
 * Self-test of the pre-commit hook (M-K3): a throwaway git repository, a synthetic secret-shaped string
 * built at run time, and the hook run as git would run it.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const HOOK = path.join(__dirname, "pre-commit");
// "S" + 55 base32 characters: shaped like a secret key, but not one (it has no valid checksum).
const SYNTHETIC = "S" + "A".repeat(55);

let dir: string;
const git = (...args: string[]) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
const hook = () => spawnSync("sh", [HOOK], { cwd: dir, encoding: "utf8" });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "hook-test-"));
  git("init", "-q");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("pre-commit hook", () => {
  it("passes when the index holds no secret-shaped string", () => {
    fs.writeFileSync(path.join(dir, "a.txt"), `G${"A".repeat(55)} and plain text\n`);
    git("add", "a.txt");
    expect(hook().status).toBe(0);
  });

  it("blocks a staged secret-shaped string, prints the file-list command, and never prints the line", () => {
    fs.writeFileSync(path.join(dir, "a.txt"), `key = ${SYNTHETIC}\n`);
    git("add", "a.txt");
    const r = hook();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("git grep --cached -lwE");
    expect(r.stdout + r.stderr).not.toContain(SYNTHETIC);
    expect(r.stdout + r.stderr).not.toContain("a.txt");
  });

  it("looks at the index, not the working tree", () => {
    fs.writeFileSync(path.join(dir, "a.txt"), "clean\n");
    git("add", "a.txt");
    fs.writeFileSync(path.join(dir, "a.txt"), `${SYNTHETIC}\n`); // unstaged edit
    expect(hook().status).toBe(0);
  });

  it("does not match a longer base32 run or a different length", () => {
    fs.writeFileSync(path.join(dir, "a.txt"), `S${"A".repeat(54)}\nS${"A".repeat(56)}\n`);
    git("add", "a.txt");
    expect(hook().status).toBe(0);
  });

  it("blocks when git grep cannot run (outside a repository)", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "hook-outside-"));
    try {
      const r = spawnSync("sh", [HOOK], { cwd: outside, encoding: "utf8", env: { ...process.env, GIT_CEILING_DIRECTORIES: os.tmpdir() } });
      expect(r.status).toBe(1);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});
