import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadUniverse } from "../chain/universe";
import { DATA_DIR, loadDeployment as loadReconFeed } from "../feed/deployment";
import { appendKeeperLog, readKeeperLog, type KeeperLogRecord } from "./log";
import {
  DEMO_PURPOSE, checkRecords, demoEvidenceHash, parseDeployment, parseScenario, syntheticKey, type KeeperDeployment,
} from "./records";
import { notEvaluatedFromStatus } from "./run";
import { BENJI_KEY, DEPLOYMENT, KEYS, RECON, SCENARIO, SCENARIO_TEXT, SYNTH_KEY, UNIVERSE, USTRY_KEY } from "./testkit";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe("K6 records: schema", () => {
  it("accepts the fixture deployment and scenario", () => {
    expect(parseDeployment(clone(DEPLOYMENT)).network).toBe("testnet");
    expect(SCENARIO.scenario.steps.map((s) => s.id)).toEqual(["open", "critical", "clean"]);
    expect(SCENARIO.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses a network other than testnet, extra fields, bad addresses and a changed demo purpose", () => {
    const bad = (mutate: (d: any) => void) => {
      const d = clone(DEPLOYMENT) as any;
      mutate(d);
      return () => parseDeployment(d);
    };
    expect(bad((d) => (d.network = "mainnet"))).toThrow(/network/);
    expect(bad((d) => (d.extra = 1))).toThrow();
    expect(bad((d) => (d.admin = "GNOPE"))).toThrow(/admin/);
    expect(bad((d) => (d.markets.live.feed = KEYS.admin))).toThrow(/contract address/);
    expect(bad((d) => (d.markets.live.pause_at = 3))).toThrow();
    expect(bad((d) => (d.markets.live.max_age_secs = 59))).toThrow();
    expect(bad((d) => (d.markets.live.assets = []))).toThrow();
    expect(bad((d) => (d.demo_feed.purpose = "A feed"))).toThrow(/purpose/);
    expect(DEMO_PURPOSE).toMatch(/Synthetic test data/);
  });

  it("refuses a scenario with another code, a status that disagrees with its flags, or other steps", () => {
    const base = JSON.parse(SCENARIO_TEXT);
    const text = (mutate: (s: any) => void) => {
      const s = clone(base);
      mutate(s);
      return () => parseScenario(JSON.stringify(s));
    };
    expect(text((s) => (s.code = "BENJI"))).toThrow();
    expect(text((s) => (s.steps[1].flags = 0))).toThrow(/status 0 needs flags 0/);
    expect(text((s) => (s.steps[0].flags = 1))).toThrow(/status 0 needs flags 0/);
    expect(text((s) => s.steps.reverse())).toThrow(/steps must be/);
    expect(text((s) => s.steps.pop())).toThrow();
    expect(text((s) => (s.issuer = "GNOPE"))).toThrow();
  });
});

describe("K6 records: consistency with data/assets.csv and the other records", () => {
  it("the fixture is consistent", () => {
    expect(checkRecords(DEPLOYMENT, SCENARIO.scenario, RECON, UNIVERSE)).toEqual([]);
  });

  it("live keys match the sac_contract_id of the asset in the real data/assets.csv (BENJI and USTRY)", () => {
    const real = loadUniverse();
    const benji = real.find((r) => r.asset_code === "BENJI");
    const ustry = real.find((r) => r.asset_code === "USTRY");
    expect(benji && ustry).toBeTruthy();
    const dep = clone(DEPLOYMENT) as KeeperDeployment;
    dep.markets.live.assets = [
      { label: "BENJI", asset: `BENJI:${benji!.issuer}`, key: benji!.sac_contract_id },
      { label: "USTRY", asset: `USTRY:${ustry!.issuer}`, key: ustry!.sac_contract_id },
    ];
    expect(benji!.sac_contract_id).toBe("CCDSDPD7FXB74PFB2SYCHGQRWLXQRYRTQSPCVSRJ7FAOLOUGWEYAXQ7A");
    expect(ustry!.sac_contract_id).toBe("CBLV4ATSIWU67CFSQU2NVRKINQIKUZ2ODSZBUJTJ43VJVRSBTZYOPNUR");
    expect(checkRecords(dep, SCENARIO.scenario, RECON, real)).toEqual([]);
    // a key that is not the one in the file is caught
    dep.markets.live.assets[1].key = benji!.sac_contract_id;
    expect(checkRecords(dep, SCENARIO.scenario, RECON, real).join(" ")).toMatch(/USTRY:.*is not the sac_contract_id/);
  });

  it("the real Recon feed record is what the live market must read, and the demo feed must not be it", () => {
    const real = loadReconFeed();
    const recon = { contract_id: real.contract_id, admin: real.admin, publisher: real.publisher };
    const dep = clone(DEPLOYMENT) as KeeperDeployment;
    dep.markets.live.feed = real.contract_id;
    expect(checkRecords(dep, SCENARIO.scenario, recon, UNIVERSE)).toEqual([]);
    expect(checkRecords(DEPLOYMENT, SCENARIO.scenario, recon, UNIVERSE).join(" ")).toMatch(/live market's feed .* is not Recon's feed/);
    const demoIsRecon = clone(dep);
    demoIsRecon.demo_feed.contract_id = real.contract_id;
    demoIsRecon.markets.demo.feed = real.contract_id;
    expect(checkRecords(demoIsRecon, SCENARIO.scenario, recon, UNIVERSE).join(" ")).toMatch(/demo feed is Recon's feed/);
  });

  it("the demo key equals syntheticKey on the testnet passphrase, names no real asset, and is in no csv row", () => {
    expect(syntheticKey("SYNTH", KEYS.writer)).toBe(SYNTH_KEY);
    expect(SYNTH_KEY).not.toBe(syntheticKey("SYNTH", KEYS.admin));
    const real = loadUniverse();
    expect(real.some((r) => r.sac_contract_id === SYNTH_KEY)).toBe(false);
    expect(real.some((r) => r.asset_code === "SYNTH")).toBe(false);
    const wrongKey = clone(DEPLOYMENT) as KeeperDeployment;
    wrongKey.markets.demo.assets[0].key = BENJI_KEY;
    expect(checkRecords(wrongKey, SCENARIO.scenario, RECON, UNIVERSE).join(" ")).toMatch(/must list exactly the synthetic key/);
    const inCsv = [...UNIVERSE, { asset_code: "X", issuer: KEYS.admin, sac_contract_id: SYNTH_KEY }];
    expect(checkRecords(DEPLOYMENT, SCENARIO.scenario, RECON, inCsv).join(" ")).toMatch(/is in data\/assets.csv/);
    const withReal = clone(DEPLOYMENT) as KeeperDeployment;
    withReal.markets.demo.assets[0].asset = `BENJI:${UNIVERSE[0].issuer}`;
    expect(checkRecords(withReal, SCENARIO.scenario, RECON, UNIVERSE).join(" ")).toMatch(/asset null/);
  });

  it("the identities must be pairwise distinct, Recon's publisher and admin included", () => {
    const same = (mutate: (d: KeeperDeployment) => void) => {
      const d = clone(DEPLOYMENT) as KeeperDeployment;
      mutate(d);
      return checkRecords(d, SCENARIO.scenario, RECON, UNIVERSE).join(" ");
    };
    expect(same((d) => (d.keeper = d.admin))).toMatch(/lending-admin and lending-keeper are the same/);
    expect(same((d) => (d.borrower = KEYS.reconPublisher))).toMatch(/lending-borrower and Recon's publisher/);
    expect(same((d) => (d.admin = KEYS.reconAdmin))).toMatch(/lending-admin and Recon's admin/);
    expect(checkRecords(DEPLOYMENT, SCENARIO.scenario, { ...RECON, publisher: KEYS.writer }, UNIVERSE).join(" ")).toMatch(/demo-feed-writer and Recon's publisher/);
  });

  it("the scenario issuer must be the demo writer", () => {
    const s = clone(SCENARIO.scenario);
    s.issuer = KEYS.admin;
    expect(checkRecords(DEPLOYMENT, s, RECON, UNIVERSE).join(" ")).toMatch(/is not the demo feed writer/);
  });
});

describe("K5 evidence hashes", () => {
  it("are deterministic, depend on the scenario, the step and the as_of, and are never zero", () => {
    const a = demoEvidenceHash(SCENARIO.sha256, "critical", 1_792_000_000n);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(demoEvidenceHash(SCENARIO.sha256, "critical", 1_792_000_000)).toBe(a);
    expect(demoEvidenceHash(SCENARIO.sha256, "clean", 1_792_000_000n)).not.toBe(a);
    expect(demoEvidenceHash(SCENARIO.sha256, "critical", 1_792_000_001n)).not.toBe(a);
    expect(demoEvidenceHash("00".repeat(32), "critical", 1_792_000_000n)).not.toBe(a);
    expect(a).not.toBe("00".repeat(32));
  });
});

describe("K6 log: atomic and append-only", () => {
  const record = (n: number): KeeperLogRecord => ({
    at: `2026-10-16T00:00:0${n}.000Z`, network: "testnet", market: "demo", contract_id: DEPLOYMENT.markets.demo.contract_id, method: "sync",
    asset_label: "SYNTH", key: SYNTH_KEY, tx_hash: String(n).repeat(64).slice(0, 64), ledger: 100 + n, decision: null, borrow_enabled_before: true, borrow_enabled_after: false,
  });
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "keeper-log-"));

  it("creates the file and keeps every earlier record byte for byte", () => {
    const dir = tmp();
    const file = path.join(dir, "keeper", "log.json");
    expect(readKeeperLog(file)).toEqual([]);
    appendKeeperLog(file, record(1));
    const first = fs.readFileSync(file, "utf8");
    appendKeeperLog(file, record(2));
    appendKeeperLog(file, record(3));
    const list = readKeeperLog(file) as KeeperLogRecord[];
    expect(list.map((r) => r.ledger)).toEqual([101, 102, 103]);
    expect(JSON.stringify(list[0], null, 2)).toBe(JSON.stringify(JSON.parse(first)[0], null, 2));
    expect(fs.readFileSync(file, "utf8").endsWith("\n")).toBe(true);
  });

  it("writes a temporary file and renames it: no temporary file is left behind", () => {
    const dir = tmp();
    const file = path.join(dir, "log.json");
    appendKeeperLog(file, record(1));
    appendKeeperLog(file, record(2));
    expect(fs.readdirSync(dir)).toEqual(["log.json"]);
  });

  it("refuses to touch a file that is not a JSON array, and leaves it as it was", () => {
    const dir = tmp();
    const file = path.join(dir, "log.json");
    fs.writeFileSync(file, '{"not":"an array"}');
    expect(() => appendKeeperLog(file, record(1))).toThrow(/must be a JSON array/);
    expect(fs.readFileSync(file, "utf8")).toBe('{"not":"an array"}');
    expect(fs.readdirSync(dir)).toEqual(["log.json"]);
  });

  it("an unparseable file is not overwritten", () => {
    const dir = tmp();
    const file = path.join(dir, "log.json");
    fs.writeFileSync(file, "[{");
    expect(() => appendKeeperLog(file, record(1))).toThrow();
    expect(fs.readFileSync(file, "utf8")).toBe("[{");
  });
});

describe("notEvaluatedFromStatus (display only)", () => {
  it("reads the not-evaluated flag names of the newest status file with this key", () => {
    const real = loadUniverse().find((r) => r.asset_code === "BENJI");
    const found = notEvaluatedFromStatus(path.join(DATA_DIR, "status"), real!.sac_contract_id);
    expect(found).not.toBeNull();
    expect(found!.file).toMatch(/^\d{4}-\d{2}-\d{2}\.json$/);
    expect(found!.flags.length).toBeGreaterThan(0);
    expect(found!.flags.every((f) => /^[A-Z_]+$/.test(f))).toBe(true);
    expect(notEvaluatedFromStatus(path.join(DATA_DIR, "status"), USTRY_KEY)).toBeNull();
    expect(notEvaluatedFromStatus(path.join(os.tmpdir(), "does-not-exist-keeper"), BENJI_KEY)).toBeNull();
  });
});
