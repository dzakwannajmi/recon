/**
 * Synthetic fixtures for `npm run monitor:demo` and the Monitor tests (spec 5.2). A fake Horizon that
 * serves a few made-up operations, and an executor that records the pipeline commands instead of
 * running them. Everything here is marked synthetic. Nothing in this file touches the network, the real
 * data folder, or a process.
 */
import fs from "fs";
import path from "path";
import { formatStroops, toStroops } from "../chain/asset";
import { loadUniverse } from "../chain/universe";
import { datedFiles } from "../flags/inputs";
import { assetKeyOf, type HorizonSource, type OpsRead, type OpsRequest, type PinnedAsset, type SupplyReads } from "./horizon";
import type { Exec } from "./pipeline";
import type { HorizonEffect, HorizonOp } from "./types";
import { opLedger } from "./types";

/** The Etherfuse issuer's real `set_options` (ledger 64807581, 2026-10-06): the field names and values the demo copies. */
export const REAL_SET_OPTIONS_FIELDS = {
  signer_key: "GAQW5UGB7IFES4R4HZ7PGEX5ZJ336QYX5LKQ6N7K7DPXMJZGKNXB4UHG",
  signer_weight: 2,
} as const;

/** A paging token for a ledger (TOID: ledger << 32 | transaction << 12 | operation). */
export const tokenFor = (ledger: number, n = 1) => (BigInt(ledger) * 2n ** 32n + BigInt(n)).toString();

export type FakeOptions = {
  /** The ledger and close time every call sees. */
  ledger: number;
  closedAt: string;
  /** Asset key -> total supply (7-decimal string). An asset missing here is "not found". */
  supplies: Record<string, string>;
  ops: Record<string, HorizonOp[]>;
  effects?: Record<string, HorizonEffect[]>;
  maxRequests?: number;
};

/** A Horizon stand-in. One request per root, asset, or page read, like the real client. */
export class FakeHorizon implements HorizonSource {
  private used = 0;
  readonly calls: string[] = [];
  constructor(private readonly o: FakeOptions) {}
  /** The same ledger history one clock step later (a later run), with a fresh request counter. */
  later(ledger: number, closedAt: string, maxRequests?: number): FakeHorizon {
    return new FakeHorizon({ ...this.o, ledger, closedAt, maxRequests: maxRequests ?? this.o.maxRequests });
  }
  get requests() { return this.used; }
  remaining() { return (this.o.maxRequests ?? 300) - this.used; }
  private spend(n: number, what: string) {
    if (this.remaining() < n) return false;
    this.used += n;
    this.calls.push(what);
    return true;
  }

  async readSupplyPoints(assets: readonly PinnedAsset[]): Promise<SupplyReads> {
    const r: SupplyReads = { points: new Map(), failures: new Map(), budgetEnded: false };
    if (!this.spend(1, "root")) return { ...r, budgetEnded: true };
    for (const a of assets) {
      const key = assetKeyOf(a);
      if (!this.spend(2, `asset ${key}`)) return { ...r, budgetEnded: true };
      const supply = this.o.supplies[key];
      if (supply) r.points.set(key, { ledger: this.o.ledger, at: this.o.closedAt, supply, source: "monitor" });
      else r.failures.set(key, "asset not found");
    }
    return r;
  }

  async readIssuerOps(issuer: string, req: OpsRequest): Promise<OpsRead> {
    const empty: OpsRead = { ops: [], newestCursor: null, coveredThroughLedger: null, coveredThroughAt: null, coveredFrom: null, caughtUp: false, partial: true, error: null, pages: 0 };
    if (!this.spend(1, `root for ${issuer}`)) return empty;
    const all = [...(this.o.ops[issuer] ?? [])].sort((a, b) => (BigInt(a.paging_token) < BigInt(b.paging_token) ? -1 : 1));
    const ops = req.mode === "forward" ? all.filter((x) => BigInt(x.paging_token) > BigInt(req.cursor)) : all.filter((x) => Date.parse(x.created_at) >= Date.parse(req.since));
    const pages = Math.max(1, Math.ceil(ops.length / 200));
    for (let p = 0; p < pages; p++) if (!this.spend(1, `ops page ${p + 1} for ${issuer}`)) return { ...empty, pages: p };
    const boundary = (BigInt(this.o.ledger + 1) << 32n) - 1n;
    const last = ops.length > 0 ? BigInt(ops[ops.length - 1].paging_token) : 0n;
    return {
      ops, newestCursor: (last > boundary ? last : boundary).toString(), coveredThroughLedger: this.o.ledger, coveredThroughAt: this.o.closedAt,
      coveredFrom: req.mode === "backfill" ? req.since : null, caughtUp: true, partial: false, error: null, pages,
    };
  }

  async readOpEffects(opId: string): Promise<HorizonEffect[] | null> {
    if (!this.spend(1, `effects ${opId}`)) return null;
    return this.o.effects?.[opId] ?? [];
  }
}

export type RecordedCall = { file: string; args: string[]; cwd: string; timeout: number; envKeys: string[] };

/** An executor that runs nothing: it records each call and reports a plain line. */
export function recordingExec(exitCodes: Record<string, number> = {}): { exec: Exec; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const exec: Exec = (file, args, opts) => {
    calls.push({ file, args, cwd: opts.cwd, timeout: opts.timeout, envKeys: Object.keys(opts.env) });
    return { exit_code: exitCodes[args[0]] ?? 0, ms: 0, output: `would run: tsx ${args.join(" ")}` };
  };
  return { exec, calls };
}

/** Copy what a Monitor run reads (assets, the publish log, every status file, the newest checks file) into a temporary data folder. */
export function copyDemoData(realDataDir: string, targetRoot: string): string {
  const data = path.join(targetRoot, "data");
  fs.mkdirSync(path.join(data, "feed"), { recursive: true });
  fs.copyFileSync(path.join(realDataDir, "assets.csv"), path.join(data, "assets.csv"));
  const log = path.join(realDataDir, "feed", "log.json");
  if (fs.existsSync(log)) fs.copyFileSync(log, path.join(data, "feed", "log.json"));
  for (const folder of ["status"]) {
    const dir = path.join(realDataDir, folder);
    if (!fs.existsSync(dir)) continue;
    fs.mkdirSync(path.join(data, folder), { recursive: true });
    for (const name of fs.readdirSync(dir)) if (name.endsWith(".json")) fs.copyFileSync(path.join(dir, name), path.join(data, folder, name));
  }
  const checksDir = path.join(realDataDir, "checks");
  const newest = datedFiles(fs.existsSync(checksDir) ? fs.readdirSync(checksDir) : [], "9999-12-31")[0];
  if (newest) {
    fs.mkdirSync(path.join(data, "checks"), { recursive: true });
    fs.copyFileSync(path.join(checksDir, newest), path.join(data, "checks", newest));
  }
  return data;
}

/** Rewrite the check times of the copied checks files to `at`, so only the scenario's events (not the schedule) make a re-check due. */
export function freshenChecks(dataDir: string, at: Date) {
  const dir = path.join(dataDir, "checks");
  if (!fs.existsSync(dir)) return;
  const iso = at.toISOString();
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name);
    const json = JSON.parse(fs.readFileSync(file, "utf8")) as { checked_at: string; results: { identity?: { checkedAt: string }; facts?: { checkedAt: string } }[] };
    json.checked_at = iso;
    for (const r of json.results) { if (r.identity) r.identity.checkedAt = iso; if (r.facts) r.facts.checkedAt = iso; }
    fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
  }
}

export type Scenario = {
  /** A made-up `set_options` by this issuer (the real Etherfuse fields), or null. */
  setOptionsFor?: string | null;
  /** Mint this share of the first pinned asset of that issuer, as a made-up payment from the issuer, dated now. */
  largeMintShare?: { issuer: string; percent: number } | null;
};

/** A fake Horizon for a temporary data folder: supplies from its newest checks file, plus the scenario's synthetic operations. */
export function syntheticHorizon(dataDir: string, now: Date, scenario: Scenario, maxRequests = 300, baseLedger = 65_000_000): { horizon: FakeHorizon; opIds: { setOptions?: string; mint?: string } } {
  const universe = loadUniverse(path.join(dataDir, "assets.csv")).filter((a) => a.issuer && a.asset_code);
  const checksDir = path.join(dataDir, "checks");
  const newest = datedFiles(fs.existsSync(checksDir) ? fs.readdirSync(checksDir) : [], "9999-12-31")[0];
  const checks = newest ? (JSON.parse(fs.readFileSync(path.join(checksDir, newest), "utf8")) as { results: { asset_code: string; issuer: string; facts?: { supply?: string } }[] }) : { results: [] };
  const supplies: Record<string, string> = {};
  for (const a of universe) {
    const supply = checks.results.find((r) => r.asset_code === a.asset_code && r.issuer === a.issuer)?.facts?.supply;
    if (supply) supplies[assetKeyOf({ code: a.asset_code, issuer: a.issuer })] = supply;
  }
  const ledger = baseLedger;
  const ops: Record<string, HorizonOp[]> = {};
  const opIds: { setOptions?: string; mint?: string } = {};
  let n = 0;
  const make = (issuer: string, type: string, minutesAgo: number, fields: Record<string, unknown>): HorizonOp => {
    const l = ledger - 10 - n;
    const token = tokenFor(l, ++n);
    const hash = `5ea1ed${String(n).padStart(2, "0")}`.padEnd(64, "0");
    const op = {
      id: token, paging_token: token, type, transaction_successful: true, source_account: issuer, created_at: new Date(now.getTime() - minutesAgo * 60_000).toISOString().replace(/\.\d+Z$/, "Z"),
      transaction_hash: hash, synthetic: true, ...fields,
    } as HorizonOp;
    ops[issuer] = [...(ops[issuer] ?? []), op];
    return op;
  };
  if (scenario.setOptionsFor) opIds.setOptions = make(scenario.setOptionsFor, "set_options", 20, { ...REAL_SET_OPTIONS_FIELDS }).id;
  if (scenario.largeMintShare) {
    const { issuer, percent } = scenario.largeMintShare;
    const asset = universe.find((a) => a.issuer === issuer && supplies[assetKeyOf({ code: a.asset_code, issuer })]);
    if (!asset) throw new Error("the scenario's issuer has no pinned asset with a stored supply");
    const key = assetKeyOf({ code: asset.asset_code, issuer });
    const amount = (toStroops(supplies[key]) * BigInt(Math.round(percent * 100))) / 10_000n;
    supplies[key] = formatStroops(toStroops(supplies[key]) + amount); // the fake ledger already includes the mint
    opIds.mint = make(issuer, "payment", 10, {
      asset_type: "credit_alphanum12", asset_code: asset.asset_code, asset_issuer: issuer, from: issuer,
      to: "GAATSWH6REDGTWRV6V2LFJDRGUKTGSDJEVPYGIXWTTOESSE7JWBUXARW", amount: formatStroops(amount),
    }).id;
  }
  // The fake ledger must be at or after every op.
  const newestLedger = Math.max(ledger, ...Object.values(ops).flat().map(opLedger));
  return { horizon: new FakeHorizon({ ledger: newestLedger, closedAt: now.toISOString().replace(/\.\d+Z$/, "Z"), supplies, ops, maxRequests }), opIds };
}
