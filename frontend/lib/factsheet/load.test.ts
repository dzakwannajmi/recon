import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";
import { loadStatus, newestStatusFile } from "./load";

describe("newestStatusFile", () => {
  it("picks the max date", () => {
    expect(newestStatusFile(["2026-10-06.json", "2026-10-08.json", "2026-09-30.json"])).toBe("2026-10-08.json");
  });
  it("ignores tmp files, impossible dates, and other names", () => {
    expect(newestStatusFile(["2026-10-06.json", "2026-10-09.json.123.tmp", "2026-02-30.json", "notes.txt", "x.json.123.tmp"])).toBe("2026-10-06.json");
  });
  it("returns null when nothing matches", () => {
    expect(newestStatusFile([])).toBeNull();
    expect(newestStatusFile(["2026-02-30.json", "notes.txt"])).toBeNull();
  });
});

describe("loadStatus", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "factsheet-load-"));
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const asset = {
    asset: "ABC:GAAA", asset_code: "ABC", issuer: "GAAA", issuer_org: "Org", asset_type: "fund",
    status: "OK", status_code: 0, flags_bitmask: 0, evidence_hash: "h", raised: [], clear: [], not_evaluated: [], extra_field: 1,
  };
  const valid = {
    generated_at: "2026-10-08T00:00:00.000Z", as_of: "2026-10-08", rules_version: "flags-v1",
    inputs: { checks: { path: "data/checks/2026-10-08.json", sha256: "a" }, previous_checks: null, examinations: null },
    bits: {}, status_codes: {}, summary: {}, assets: [asset],
  };
  const write = (name: string, body: unknown) => {
    const dir = path.join(tmp, name, "status");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "2026-10-08.json"), typeof body === "string" ? body : JSON.stringify(body));
    return path.join(tmp, name);
  };

  it("reads a valid file and allows extra fields", () => {
    const loaded = loadStatus(write("valid", valid));
    expect(loaded.file).toBe("2026-10-08.json");
    expect(loaded.status.assets).toHaveLength(1);
    expect(loaded.status.assets[0].asset_code).toBe("ABC");
  });
  it("throws a clear error when there is no file", () => {
    expect(() => loadStatus(path.join(tmp, "missing"))).toThrow(/No data\/status/);
  });
  it("throws when the file is invalid", () => {
    expect(() => loadStatus(write("bad-shape", { ...valid, assets: [{ ...asset, status: "GREAT" }] }))).toThrow(/invalid/);
    expect(() => loadStatus(write("bad-json", "{nope"))).toThrow(/not valid JSON/);
    expect(() => loadStatus(write("no-assets", { ...valid, assets: undefined }))).toThrow(/invalid/);
  });
  it("throws when as_of does not match the file name", () => {
    expect(() => loadStatus(write("as-of-mismatch", { ...valid, as_of: "2026-10-07" }))).toThrow(/as_of/);
  });
  it("parses the real newest status file (smoke)", () => {
    const { file, status } = loadStatus();
    expect(file).toMatch(/^\d{4}-\d{2}-\d{2}\.json$/);
    expect(status.assets.length).toBeGreaterThan(0);
  });
});
