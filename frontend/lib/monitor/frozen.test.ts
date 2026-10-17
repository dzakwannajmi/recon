import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { assertDay, assertWritable, frozenPaths, loadFrozen, targetFiles } from "./frozen";

const STATUS = {
  inputs: {
    checks: { path: "data/checks/2026-10-15.json", sha256: "a" },
    previous_checks: { path: "data/checks/2026-10-09.json", sha256: "b" },
    checks_history: [{ path: "data/checks/2026-10-06.json", sha256: "c" }, { path: "data/checks/2026-10-15.json", sha256: "a" }],
    examinations: { path: "data/examinations/2026-10-15.json", sha256: "d" },
    issuance: { path: "data/monitor/issuance/2026-10-15.json", sha256: "e" },
    claims: { path: "data/claims/claims.json", sha256: "f" },
    reviews: null,
  },
};

describe("Z1: frozenPaths", () => {
  it("collects the status file and every day file its inputs name, with the status that used it", () => {
    const frozen = frozenPaths([{ status_file: "data/status/2026-10-15.json" }], () => STATUS);
    expect([...frozen.keys()].sort()).toEqual([
      "data/checks/2026-10-06.json", "data/checks/2026-10-09.json", "data/checks/2026-10-15.json",
      "data/examinations/2026-10-15.json", "data/monitor/issuance/2026-10-15.json", "data/status/2026-10-15.json",
    ]);
    expect(frozen.get("data/checks/2026-10-15.json")).toBe("data/status/2026-10-15.json");
    expect(frozen.has("data/claims/claims.json")).toBe(false);
  });

  it("copes with older status files (no issuance, no history) and an empty log", () => {
    const frozen = frozenPaths([{ status_file: "data/status/a.json" }], () => ({ inputs: { checks: { path: "data/checks/x.json" }, examinations: null, previous_checks: null } }));
    expect([...frozen.keys()].sort()).toEqual(["data/checks/x.json", "data/status/a.json"]);
    expect(frozenPaths([], () => null).size).toBe(0);
  });

  it("a log record whose status file is missing is an error", () => {
    expect(() => frozenPaths([{ status_file: "data/status/gone.json" }], () => null)).toThrow(/data\/status\/gone\.json.*missing/);
  });
});

describe("Z1: assertWritable", () => {
  const dirs: string[] = [];
  afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
  const repo = (log: unknown) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "frozen-"));
    dirs.push(root);
    fs.mkdirSync(path.join(root, "data", "feed"), { recursive: true });
    fs.mkdirSync(path.join(root, "data", "status"), { recursive: true });
    fs.writeFileSync(path.join(root, "data", "feed", "log.json"), JSON.stringify(log));
    fs.writeFileSync(path.join(root, "data", "status", "2026-10-15.json"), JSON.stringify(STATUS));
    return path.join(root, "data");
  };

  it("refuses a frozen file with the documented message, allows new and unfrozen files", () => {
    const data = repo([{ status_file: "data/status/2026-10-15.json", confirmed: false }]);
    expect(() => assertWritable("data/checks/2026-10-15.json", data)).toThrow(
      "refusing to overwrite data/checks/2026-10-15.json: published status data/status/2026-10-15.json used it (data/feed/log.json)",
    );
    expect(() => assertWritable("data/status/2026-10-15.json", data)).toThrow(/refusing to overwrite/);
    expect(() => assertWritable("data/checks/2026-10-16.json", data)).not.toThrow();
    expect(() => assertWritable("data/checks/2026-10-08.json", data)).not.toThrow();
  });

  it("is an error when the log names a status file that does not exist, and allows everything without a log", () => {
    const data = repo([{ status_file: "data/status/missing.json" }]);
    expect(() => assertWritable("data/checks/2026-10-16.json", data)).toThrow(/missing or unreadable/);
    fs.rmSync(path.join(data, "feed", "log.json"));
    expect(() => assertWritable("data/checks/2026-10-15.json", data)).not.toThrow();
    expect(loadFrozen(data).size).toBe(0);
  });

  it("names the four day files of a run", () => {
    expect(targetFiles("2026-10-17")).toEqual(["data/checks/2026-10-17.json", "data/examinations/2026-10-17.json", "data/status/2026-10-17.json", "data/monitor/issuance/2026-10-17.json"]);
  });

  it("holds against the real repository: the published files are frozen, a future day's are not", () => {
    expect(() => assertWritable("data/checks/2026-10-15.json")).toThrow(/refusing to overwrite/);
    expect(() => assertWritable("data/status/2026-10-09.json")).toThrow(/refusing to overwrite/);
    expect(() => assertWritable("data/checks/2099-01-01.json")).not.toThrow();
  });
});

describe("Z1: each writer calls the guard before its first network read", () => {
  const text = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
  const firstIndex = (src: string, patterns: RegExp[]) => Math.min(...patterns.map((p) => { const m = p.exec(src); return m ? m.index : Infinity; }));

  it("check-assets.ts: before any chain read, and again before the write", () => {
    const src = text("scripts/check-assets.ts");
    const guard = src.indexOf("assertWritable(target)");
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(firstIndex(src, [/getAssetFacts\(/, /checkIssuerIdentity\(/, /await /]));
    expect(src.indexOf("assertWritable(target)", guard + 1)).toBeLessThan(src.indexOf("fs.writeFileSync"));
  });

  it("examine.ts: before any network read or write, and again before the writes", () => {
    const src = text("scripts/examine.ts");
    const start = src.indexOf("async function main");
    const guard = src.indexOf("assertWritable(target)");
    expect(guard).toBeGreaterThan(start);
    expect(guard - start).toBeLessThan(firstIndex(src.slice(start), [/await /, /getAssetFacts\(/, /fetchUntrustedBytes\(/, /listIssuers\(/, /writeJson\(/, /snapshots\.flush\(/]));
    const second = src.indexOf("assertWritable(target)", guard + 1);
    expect(second).toBeGreaterThan(guard);
    expect(second).toBeLessThan(src.indexOf("snapshots.flush()"));
    expect(second).toBeLessThan(src.indexOf('writeJson(path.join(DATA, "claims"'));
  });

  it("status.ts: before the status is computed, and again before the write", () => {
    const src = text("scripts/status.ts");
    const guard = src.indexOf("assertWritable(rel, DATA)");
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(src.indexOf("buildStatus("));
    expect(src.indexOf("assertWritable(rel, DATA)", guard + 1)).toBeLessThan(src.indexOf("writeJson(out"));
  });
});

describe("assertDay: a run that crosses midnight never mixes two days", () => {
  it("passes without --day or on the same UTC day, and refuses another day or a bad value", () => {
    expect(() => assertDay("2026-10-17T23:59:00.000Z", [])).not.toThrow();
    expect(() => assertDay("2026-10-17T23:59:00.000Z", ["--day", "2026-10-17"])).not.toThrow();
    expect(() => assertDay("2026-10-18T00:01:00.000Z", ["--day", "2026-10-17"])).toThrow(/planned for 2026-10-17 but the UTC day is now 2026-10-18/);
    expect(() => assertDay("2026-10-17T10:00:00.000Z", ["--day", "x"])).toThrow(/--day must be/);
    expect(() => assertDay("2026-10-17T10:00:00.000Z", ["--day"])).toThrow(/--day must be/);
  });

  it("check-assets.ts and examine.ts call it right after fixing checkedAt, before the guard and any network read", () => {
    for (const f of ["scripts/check-assets.ts", "scripts/examine.ts"]) {
      const src = fs.readFileSync(path.join(process.cwd(), f), "utf8");
      const day = src.indexOf("assertDay(checkedAt");
      expect(day, f).toBeGreaterThan(src.indexOf("const checkedAt"));
      expect(day, f).toBeLessThan(src.indexOf("assertWritable(target)"));
    }
  });
});
