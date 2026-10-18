import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formatStroops } from "../chain/asset";
import { buildIssuance, stableJson } from "../monitor/issuance";
import { advance, emptyAssetState } from "../monitor/reconcile";
import type { MonitorState, Point } from "../monitor/types";
import { buildStatus, resolveOut } from "./run";

const REAL = path.join(process.cwd(), "..", "data");
const BENJI = "BENJI:GBHNGLLIE3KWGKCHIKMHJ5HVZHYIK7WTBE4QF5PLAKL4CJGSEU7HZIW5";
const NOW = new Date("2026-10-17T12:00:00Z");

describe("F3: a dry recompute of the published 2026-10-15 status", () => {
  const published = JSON.parse(fs.readFileSync(path.join(REAL, "status", "2026-10-15.json"), "utf8"));
  const fresh = buildStatus({ dataDir: REAL, asOf: "2026-10-15", now: NOW });

  it("gives the same status, bitmask, check time, and change time for all 27 assets", () => {
    expect(fresh.assets).toHaveLength(27);
    expect(fresh.assets.map((a) => [a.asset, a.status, a.flags_bitmask, a.checked_at, a.issuer_change_seen_at]))
      .toEqual(published.assets.map((a: Record<string, unknown>) => [a.asset, a.status, a.flags_bitmask, a.checked_at, a.issuer_change_seen_at]));
  });

  it("changes only the rules version, the evidence hashes, the LARGE_MINT_BURN reason, and one new input", () => {
    expect(published.rules_version).toBe("flags-v3");
    expect(fresh.rules_version).toBe("flags-v4");
    expect(fresh.summary).toEqual(published.summary);
    expect(JSON.parse(JSON.stringify(fresh.inputs))).toEqual({ ...published.inputs, issuance: null });
    for (const [i, a] of fresh.assets.entries()) {
      const p = published.assets[i];
      expect(a.raised, a.asset).toEqual(p.raised);
      expect(a.clear, a.asset).toEqual(p.clear);
      const [lmb, others] = [a.not_evaluated.find((n) => n.flag === "LARGE_MINT_BURN"), a.not_evaluated.filter((n) => n.flag !== "LARGE_MINT_BURN")];
      expect(others, a.asset).toEqual(p.not_evaluated.filter((n: { flag: string }) => n.flag !== "LARGE_MINT_BURN"));
      expect(lmb, a.asset).toEqual({ flag: "LARGE_MINT_BURN", outcome: "not_evaluated", reason: "No daily issuance data from the Monitor for this asset." });
      expect(a.evidence_hash).not.toBe(p.evidence_hash);
    }
  });
});

describe("F2: status with a fixture issuance file", () => {
  let dir = "";
  const pt = (ledger: number, at: string, supply: number): Point => ({ ledger, at, supply: formatStroops(BigInt(supply) * 10_000_000n), source: "monitor" });
  const issuanceFile = (mint: number) => {
    let s = advance(emptyAssetState("2026-10-15"), [pt(1, "2026-10-06T12:00:00Z", 1000)], [], []).state;
    s = advance(s, [pt(9, "2026-10-15T02:00:00Z", 1000 + mint)], [
      { ledger: 5, at: "2026-10-12T10:00:00Z", tx: "txlarge", side: "mint", amount: BigInt(mint) * 10_000_000n },
    ], []).state;
    const state: MonitorState = { version: 1, issuers: {}, assets: { [BENJI]: s }, pending: [] };
    return buildIssuance("2026-10-15", "2026-10-15T02:30:00.000Z", state, [BENJI]);
  };
  const write = (file: unknown) => {
    fs.mkdirSync(path.join(dir, "monitor", "issuance"), { recursive: true });
    fs.writeFileSync(path.join(dir, "monitor", "issuance", "2026-10-15.json"), stableJson(file));
  };
  const benji = (o: ReturnType<typeof buildStatus>) => o.assets.find((a) => a.asset === BENJI)!;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "status-"));
    fs.copyFileSync(path.join(REAL, "assets.csv"), path.join(dir, "assets.csv"));
    for (const folder of ["checks", "examinations", "claims"]) fs.cpSync(path.join(REAL, folder), path.join(dir, folder), { recursive: true });
    fs.mkdirSync(path.join(dir, "snapshots"));
    fs.copyFileSync(path.join(REAL, "snapshots", "index.json"), path.join(dir, "snapshots", "index.json"));
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  const run = () => buildStatus({ dataDir: dir, asOf: "2026-10-15", now: NOW, assetsCsv: path.join(dir, "assets.csv") });

  it("without a file: inputs.issuance is null and LARGE_MINT_BURN is not evaluated with the new reason", () => {
    const o = run();
    expect(o.inputs.issuance).toBeNull();
    expect(benji(o).not_evaluated.find((n) => n.flag === "LARGE_MINT_BURN")?.reason).toBe("No daily issuance data from the Monitor for this asset.");
  });

  it("with a file: inputs.issuance names it with its hash, and a large proven day raises WARNING (bit 5)", () => {
    write(issuanceFile(700));
    const o = run();
    expect(o.inputs.issuance).toMatchObject({ path: "data/monitor/issuance/2026-10-15.json", sha256: expect.stringMatching(/^[0-9a-f]{64}$/), generated_at: "2026-10-15T02:30:00.000Z" });
    const b = benji(o);
    expect(b.raised.map((r) => r.flag)).toContain("LARGE_MINT_BURN");
    expect(b.flags_bitmask & (1 << 5)).toBe(1 << 5);
    expect(b.status).toBe("WARNING");
    const e = b.raised.find((r) => r.flag === "LARGE_MINT_BURN")!;
    expect(e.statement).toContain("Single-day mint of 700 on 2026-10-12");
    expect(e.evidence).toEqual([{ kind: "chain_check", ref: `data/monitor/issuance/2026-10-15.json#${BENJI}#2026-10-12` }]);
    // an asset the file does not list stays not evaluated
    expect(o.assets.find((a) => a.asset_code === "gBENJI")!.not_evaluated.some((n) => n.flag === "LARGE_MINT_BURN")).toBe(true);
  });

  it("the evidence hash changes when the file changes", () => {
    write(issuanceFile(700));
    const one = run();
    write(issuanceFile(701));
    const two = run();
    expect((two.inputs.issuance as { sha256: string }).sha256).not.toBe((one.inputs.issuance as { sha256: string }).sha256);
    expect(benji(two).evidence_hash).not.toBe(benji(one).evidence_hash);
    // an unrelated asset's hash changes too: the file is a status input (D-039)
    expect(two.assets[5].evidence_hash).not.toBe(one.assets[5].evidence_hash);
  });

  it("a quiet proven week is clear", () => {
    write(issuanceFile(1));
    expect(benji(run()).clear.some((c) => c.flag === "LARGE_MINT_BURN")).toBe(true);
  });

  it("an invalid issuance file stops the run", () => {
    write({ monitor_version: 9 });
    expect(run).toThrow(/issuance file is invalid/);
  });

  it("uses the newest file dated on or before as-of only", () => {
    write(issuanceFile(700));
    fs.writeFileSync(path.join(dir, "monitor", "issuance", "2026-10-16.json"), "not json");
    expect(run().inputs.issuance).toMatchObject({ path: "data/monitor/issuance/2026-10-15.json" });
  });
});

describe("F2: --out", () => {
  const data = "/repo/data";
  it("is null when absent, resolves a path outside data/, and refuses any path inside data/", () => {
    expect(resolveOut([], data)).toBeNull();
    expect(resolveOut(["--out", "/tmp/s.json"], data)).toBe("/tmp/s.json");
    expect(() => resolveOut(["--out", "/repo/data/status/x.json"], data)).toThrow(/outside data/);
    expect(() => resolveOut(["--out", "/repo/data/../data/status/x.json"], data)).toThrow(/outside data/);
    expect(() => resolveOut(["--out", "/repo/data"], data)).toThrow(/outside data/);
    expect(resolveOut(["--out", "/repo/database/x.json"], data)).toBe("/repo/database/x.json");
    expect(() => resolveOut(["--out"], data)).toThrow(/needs a file path/);
    expect(() => resolveOut(["--out", "--as-of"], data)).toThrow(/needs a file path/);
  });
});
