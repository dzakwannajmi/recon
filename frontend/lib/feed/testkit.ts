/**
 * Test helpers for the feed modules: the real 2026-10-08 status file, a deployment fixture,
 * and an in-memory feed that behaves like the contract's read and write paths. No network.
 */
import fs from "fs";
import path from "path";
import { Keypair } from "@stellar/stellar-sdk";
import { assetEvidenceHash } from "../flags/status";
import type { FeedClient, PublishResult, Roles, SimulationResult } from "./client";
import type { Deployment } from "./deployment";
import { FeedError, fileFieldsOf, parseStatusFile, toUpdate, type Entry, type StatusFile, type Update } from "./encode";
import type { Git, LogRecord } from "./publish";

export const STATUS_REL = "data/status/2026-10-08.json";
export const REPO_ROOT = path.join(process.cwd(), "..");

export const loadStatusText = () => fs.readFileSync(path.join(REPO_ROOT, STATUS_REL), "utf8");
/** A fresh deep copy of the real status file. */
export const loadStatusJson = (): Record<string, any> => JSON.parse(loadStatusText());
export const loadStatus = (): StatusFile => parseStatusFile(loadStatusJson());

/** Keys for tests only; the seeds are public constants, not secrets. */
export const PUBLISHER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 2));
export const OTHER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 3));
export const ADMIN = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1));

export const DEPLOYMENT: Deployment = {
  network: "testnet",
  contract_id: "CA4JGI47NZ4DYZT6SIXFJU4TVJPKC7QHYQXLKUZ2C7BT3ZX4ZXHO6YIK",
  wasm_hash: "ab".repeat(32),
  deploy_tx: "cd".repeat(32),
  deployed_at: "2026-10-09T12:00:00.000Z",
  admin: ADMIN.publicKey(),
  publisher: PUBLISHER.publicKey(),
  sdk: "29.0.0",
};

/** The updates of every published asset in the file. */
export function updatesOf(file: StatusFile): Update[] {
  const fields = fileFieldsOf(file);
  return file.assets.filter((a) => a.status !== null).map((a) => toUpdate(fields, a));
}

/** Set an asset's status to null the way Part B would, with a hash that recomputes. */
export function withUnpublished(json: Record<string, any>, code: string): Record<string, any> {
  const a = json.assets.find((x: any) => x.asset_code === code);
  a.status = null;
  a.status_code = null;
  a.flags_bitmask = 0;
  a.evidence_hash = assetEvidenceHash(json as never, a);
  return json;
}

export type FakeFeed = FeedClient & {
  entries: Map<string, Entry>;
  roles: Roles;
  passphraseValue: string;
  balance: bigint;
  calls: { publishBatch: Update[][]; simulatePublish: Update[][]; readEntries: string[][] };
  /** Fail the nth (1-based) publishBatch with this error. */
  failBatch: { n: number; error: FeedError } | null;
  /** Make simulatePublish fail for any batch containing an asset with this key. */
  failSimulationFor: Map<string, FeedError>;
};

export function fakeFeed(): FakeFeed {
  let ledger = 1000;
  const feed: FakeFeed = {
    entries: new Map(),
    roles: { admin: ADMIN.publicKey(), publisher: PUBLISHER.publicKey(), schema: 1 },
    passphraseValue: "Test SDF Network ; September 2015",
    balance: 10_000n * 10_000_000n,
    calls: { publishBatch: [], simulatePublish: [], readEntries: [] },
    failBatch: null,
    failSimulationFor: new Map(),
    async passphrase() {
      return feed.passphraseValue;
    },
    async balanceStroops() {
      return feed.balance;
    },
    async readEntries(keys) {
      feed.calls.readEntries.push([...keys]);
      return keys.map((k) => feed.entries.get(k) ?? null);
    },
    async readRoles() {
      return feed.roles;
    },
    async simulatePublish(updates): Promise<SimulationResult> {
      feed.calls.simulatePublish.push([...updates]);
      for (const u of updates) {
        const err = feed.failSimulationFor.get(u.asset);
        if (err) throw err;
      }
      return { written: updates.length, minResourceFee: "12345" };
    },
    async publishBatch(updates): Promise<PublishResult> {
      feed.calls.publishBatch.push([...updates]);
      const n = feed.calls.publishBatch.length;
      if (feed.failBatch && feed.failBatch.n === n) throw feed.failBatch.error;
      ledger += 1;
      for (const u of updates) feed.entries.set(u.asset, { ...u, version: 1, published_ledger: ledger });
      return { txHash: n.toString(16).padStart(64, "0"), ledger, written: updates.length };
    },
  };
  return feed;
}

/** Git as a test double: the file is tracked and clean unless told otherwise. */
export function fakeGit(over: Partial<{ tracked: boolean; modified: boolean; head: string }> = {}): Git {
  const { tracked = true, modified = false, head = "0123456789abcdef0123456789abcdef01234567" } = over;
  return { isTracked: () => tracked, isModified: () => modified, head: () => head };
}

export const collect = () => {
  const lines: string[] = [];
  return { lines, out: (line: string) => void lines.push(line) };
};

export const logs = () => {
  const records: LogRecord[] = [];
  return { records, appendLog: (r: LogRecord) => void records.push(r) };
};
