import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { Networks } from "@stellar/stellar-sdk";
import { afterEach, describe, expect, it } from "vitest";
import { sha256Hex } from "../documents/store";
import { FeedError, fileFieldsOf, parseStatusFile } from "./encode";
import { PreconditionError, appendLogFile, chunk, runPublish, shellGit, type PublishDeps, type PublishOptions, type LogRecord } from "./publish";
import { DEPLOYMENT, OTHER, PUBLISHER, STATUS_REL, collect, fakeFeed, fakeGit, loadStatus, loadStatusJson, loadStatusText, logs, updatesOf, withUnpublished } from "./testkit";
import { formatVerifyTable, verifyFile } from "./verify";

const FIXED_NOW = new Date("2026-10-10T09:00:00.000Z");
const OPTS: PublishOptions = { statusPath: STATUS_REL, dryRun: false, batchSize: 25 };

type Setup = { feed: ReturnType<typeof fakeFeed>; deps: PublishDeps; lines: string[]; records: LogRecord[] };
function setup(over: Partial<PublishDeps> = {}, text: string = loadStatusText()): Setup {
  const feed = fakeFeed();
  const { lines, out } = collect();
  const { records, appendLog } = logs();
  const deps: PublishDeps = {
    deployment: DEPLOYMENT, rpcUrl: "https://soroban-testnet.stellar.org", client: feed, keypair: PUBLISHER, git: fakeGit(),
    readFile: () => text, appendLog, now: () => FIXED_NOW, out, ...over,
  };
  return { feed, deps, lines, records };
}
const refusal = async (opts: PublishOptions, deps: PublishDeps) => runPublish(opts, deps).then(() => null, (e) => e);

describe("happy path", () => {
  it("publishes the 27 published assets in 2 transactions (25 + 2), logs both, and verifies", async () => {
    const { feed, deps, records, lines } = setup();
    const summary = await runPublish(OPTS, deps);
    expect(feed.calls.publishBatch.map((b) => b.length)).toEqual([25, 2]);
    expect(summary).toMatchObject({ ok: true, failure: null, dryRun: false });
    expect(summary.published).toHaveLength(27);
    expect(summary.txHashes).toHaveLength(2);
    expect(feed.entries.size).toBe(27);
    expect(summary.verify).toHaveLength(27);
    expect(summary.verify!.every((r) => r.ok)).toBe(true);
    expect(lines.join("\n")).toContain("27 checked, 27 match, 0 mismatch");
    expect(records).toHaveLength(2);
  });

  it("appends a log record per transaction in the documented shape", async () => {
    const { deps, records } = setup();
    await runPublish(OPTS, deps);
    const [first, second] = records;
    expect(Object.keys(first)).toEqual(["at", "network", "contract_id", "tx_hash", "ledger", "status_file", "status_sha256", "commit", "assets"]);
    expect(first).toMatchObject({
      at: "2026-10-10T09:00:00.000Z", network: "testnet", contract_id: DEPLOYMENT.contract_id, status_file: STATUS_REL,
      status_sha256: sha256Hex(loadStatusText()), commit: "0123456789abcdef0123456789abcdef01234567",
    });
    expect(first.tx_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.assets).toHaveLength(25);
    expect(second.assets).toHaveLength(2);
    expect(Object.keys(first.assets[0])).toEqual(["asset", "sac_contract_id", "status", "flags", "evidence_hash", "as_of"]);
    const ustry = [...first.assets, ...second.assets].find((a) => a.asset.startsWith("USTRY:"))!;
    expect(ustry).toEqual({
      asset: "USTRY:GCRYUGD5NVARGXT56XEZI5CIFCQETYHAPQQTHO2O3IQZTHDH4LATMYWC", sac_contract_id: "CBLV4ATSIWU67CFSQU2NVRKINQIKUZ2ODSZBUJTJ43VJVRSBTZYOPNUR",
      status: 1, flags: 24, evidence_hash: "a481142e1e5f02360ec8e1a307b629a8357aa004d2c9125872bb0829c51286e2", as_of: 1791423259,
    });
  });

  it("never prints the secret key", async () => {
    const { deps, lines } = setup();
    await runPublish(OPTS, deps);
    const all = lines.join("\n");
    expect(all).toContain(PUBLISHER.publicKey());
    expect(all).not.toContain(PUBLISHER.secret());
  });
});

describe("chunking", () => {
  it("splits at the batch size", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 25)).toEqual([]);
    expect(chunk(Array.from({ length: 27 }, (_, i) => i), 25).map((c) => c.length)).toEqual([25, 2]);
  });

  it("--batch-size 10 gives 10 + 10 + 7, one transaction at a time", async () => {
    const { feed, deps, records } = setup();
    await runPublish({ ...OPTS, batchSize: 10 }, deps);
    expect(feed.calls.publishBatch.map((b) => b.length)).toEqual([10, 10, 7]);
    expect(records).toHaveLength(3);
  });

  it("rejects a batch size outside 1 to 25", async () => {
    for (const batchSize of [0, 26, -1, 1.5]) {
      const { feed, deps } = setup();
      await expect(runPublish({ ...OPTS, batchSize }, deps)).rejects.toThrow(/--batch-size/);
      expect(feed.calls.publishBatch).toHaveLength(0);
    }
  });
});

describe("precondition 1: network", () => {
  it("refuses a passphrase that is not testnet", async () => {
    const { feed, deps } = setup();
    feed.passphraseValue = Networks.PUBLIC;
    const err = await refusal(OPTS, deps);
    expect(err).toBeInstanceOf(PreconditionError);
    expect(err).toMatchObject({ precondition: 1 });
    expect(err.message).toMatch(/not testnet/);
    expect(feed.calls.publishBatch).toHaveLength(0);
  });

  it("refuses a deployment record that is not testnet, and a non-https RPC URL", async () => {
    const a = setup({ deployment: { ...DEPLOYMENT, network: "mainnet" as never } });
    expect(await refusal(OPTS, a.deps)).toMatchObject({ precondition: 1 });
    const b = setup({ rpcUrl: "http://soroban-testnet.stellar.org" });
    expect(await refusal(OPTS, b.deps)).toMatchObject({ precondition: 1 });
    expect(a.feed.calls.publishBatch.length + b.feed.calls.publishBatch.length).toBe(0);
  });
});

describe("precondition 2: the signer", () => {
  it("refuses a wallet that is not deployment.publisher", async () => {
    const { feed, deps } = setup({ keypair: OTHER });
    expect(await refusal(OPTS, deps)).toMatchObject({ precondition: 2 });
    expect(feed.calls.publishBatch).toHaveLength(0);
  });

  it("refuses when the contract's publisher() differs", async () => {
    const { feed, deps } = setup();
    feed.roles = { ...feed.roles, publisher: OTHER.publicKey() };
    const err = await refusal(OPTS, deps);
    expect(err).toMatchObject({ precondition: 2 });
    expect(err.message).toMatch(/publisher\(\)/);
  });

  it("refuses a real run without a wallet, but a dry run may go on without one", async () => {
    const real = setup({ keypair: null });
    expect(await refusal(OPTS, real.deps)).toMatchObject({ precondition: 2 });
    const dry = setup({ keypair: null });
    const summary = await runPublish({ ...OPTS, dryRun: true }, dry.deps);
    expect(summary.ok).toBe(true);
  });

  it("never puts the secret key in an error message", async () => {
    const { deps } = setup({ keypair: OTHER });
    const err = await refusal(OPTS, deps);
    expect(err.message).not.toContain(OTHER.secret());
  });
});

describe("precondition 3: the status file in git", () => {
  it("refuses a modified file (mock git)", async () => {
    const { feed, deps } = setup({ git: fakeGit({ modified: true }) });
    const err = await refusal(OPTS, deps);
    expect(err).toMatchObject({ precondition: 3 });
    expect(err.message).toMatch(/uncommitted/);
    expect(feed.calls.publishBatch).toHaveLength(0);
  });

  it("refuses an untracked file and a path outside data/status", async () => {
    expect(await refusal(OPTS, setup({ git: fakeGit({ tracked: false }) }).deps)).toMatchObject({ precondition: 3 });
    for (const statusPath of ["data/checks/2026-10-08.json", "../data/status/2026-10-08.json", "data/status/latest.json", "/etc/passwd"]) {
      expect(await refusal({ ...OPTS, statusPath }, setup().deps)).toMatchObject({ precondition: 3 });
    }
  });

  it("records git rev-parse HEAD as the commit", async () => {
    const { deps, records } = setup({ git: fakeGit({ head: "f".repeat(40) }) });
    await runPublish(OPTS, deps);
    expect(records[0].commit).toBe("f".repeat(40));
  });

  it("refuses a file that is not a status file", async () => {
    expect(await refusal(OPTS, setup({}, '{"assets": 3}').deps)).toMatchObject({ precondition: 3 });
    expect(await refusal(OPTS, setup({}, "not json").deps)).toMatchObject({ precondition: 3 });
  });
});

describe("precondition 4: schema", () => {
  it("refuses when the file's feed_schema is not the contract's schema()", async () => {
    const { feed, deps } = setup();
    feed.roles = { ...feed.roles, schema: 2 };
    const err = await refusal(OPTS, deps);
    expect(err).toMatchObject({ precondition: 4 });
    expect(feed.calls.publishBatch).toHaveLength(0);
  });

  it("refuses a file with another feed_schema even if the contract matches it", async () => {
    const json = loadStatusJson();
    json.feed_schema = 2;
    const { feed, deps } = setup({}, JSON.stringify(json));
    feed.roles = { ...feed.roles, schema: 2 };
    expect(await refusal(OPTS, deps)).toMatchObject({ precondition: 4 });
  });
});

describe("precondition 5: hash and key recompute", () => {
  it("refuses an edited flag, whose hash no longer recomputes", async () => {
    const json = loadStatusJson();
    json.assets.find((a: any) => a.asset_code === "GOLD").flags_bitmask = 1;
    const { feed, deps } = setup({}, JSON.stringify(json));
    const err = await refusal(OPTS, deps);
    expect(err).toMatchObject({ precondition: 5 });
    expect(err.message).toMatch(/GOLD.*recomputed hash/);
    expect(feed.calls.publishBatch).toHaveLength(0);
  });

  it("refuses an edited evidence_hash", async () => {
    const json = loadStatusJson();
    json.assets[3].evidence_hash = "0".repeat(64);
    expect(await refusal(OPTS, setup({}, JSON.stringify(json)).deps)).toMatchObject({ precondition: 5 });
  });

  it("refuses a wrong sac_contract_id", async () => {
    const json = loadStatusJson();
    json.assets[0].sac_contract_id = json.assets[1].sac_contract_id;
    const { deps } = setup({}, JSON.stringify(json));
    const err = await refusal(OPTS, deps);
    expect(err).toMatchObject({ precondition: 5 });
    expect(err.message).toMatch(/does not match the contract ID derived|appears twice/);
  });

  it("refuses an edit in the inputs block (it is hashed)", async () => {
    const json = loadStatusJson();
    json.inputs.claims.sha256 = "0".repeat(64);
    expect(await refusal(OPTS, setup({}, JSON.stringify(json)).deps)).toMatchObject({ precondition: 5 });
  });

  it("skips an asset with status null but still checks its hash", async () => {
    const json = withUnpublished(loadStatusJson(), "USTRY");
    const { feed, deps } = setup({}, JSON.stringify(json));
    const summary = await runPublish(OPTS, deps);
    expect(summary.unpublished).toEqual(["USTRY:GCRYUGD5NVARGXT56XEZI5CIFCQETYHAPQQTHO2O3IQZTHDH4LATMYWC"]);
    expect(feed.calls.publishBatch.map((b) => b.length)).toEqual([25, 1]);
    expect(feed.entries.has("CBLV4ATSIWU67CFSQU2NVRKINQIKUZ2ODSZBUJTJ43VJVRSBTZYOPNUR")).toBe(false);
  });
});

describe("precondition 6: current entries", () => {
  it("skips an asset whose as_of and hash equal the entry's", async () => {
    const { feed, deps, records } = setup();
    const updates = updatesOf(loadStatus());
    for (const u of updates.slice(0, 5)) feed.entries.set(u.asset, { ...u, version: 1, published_ledger: 1 });
    const summary = await runPublish(OPTS, deps);
    expect(summary.skipped).toHaveLength(5);
    expect(summary.published).toHaveLength(22);
    expect(feed.calls.publishBatch.map((b) => b.length)).toEqual([22]);
    expect(records[0].assets).toHaveLength(22);
    expect(summary.ok).toBe(true);
  });

  it("running the same file again skips every asset, sends nothing, and still verifies", async () => {
    const first = setup();
    await runPublish(OPTS, first.deps);
    const second = setup();
    second.feed.entries = first.feed.entries;
    const summary = await runPublish(OPTS, second.deps);
    expect(summary.skipped).toHaveLength(27);
    expect(summary.published).toHaveLength(0);
    expect(second.feed.calls.publishBatch).toHaveLength(0);
    expect(second.records).toHaveLength(0);
    expect(summary.verify).toHaveLength(27);
    expect(summary.ok).toBe(true);
    expect(second.lines.join("\n")).toContain("27 already published");
  });

  it("refuses the whole run when one as_of is older than the entry's, sending nothing", async () => {
    const { feed, deps } = setup();
    const updates = updatesOf(loadStatus());
    feed.entries.set(updates[7].asset, { ...updates[7], as_of: updates[7].as_of + 1n, version: 1, published_ledger: 1 });
    const err = await refusal(OPTS, deps);
    expect(err).toBeInstanceOf(PreconditionError);
    expect(err).toMatchObject({ precondition: 6 });
    expect(err.message).toMatch(/StaleAsOf/);
    expect(feed.calls.publishBatch).toHaveLength(0);
    expect(feed.entries.size).toBe(1); // nothing else was written, not even the assets that were fine
  });

  it("an equal as_of with a different hash is published (a re-evaluation)", async () => {
    const { feed, deps } = setup();
    const updates = updatesOf(loadStatus());
    feed.entries.set(updates[2].asset, { ...updates[2], evidence_hash: "9".repeat(64), version: 1, published_ledger: 1 });
    const summary = await runPublish(OPTS, deps);
    expect(summary.published).toHaveLength(27);
  });

  it("refuses when the change time would move back", async () => {
    const { feed, deps } = setup();
    const ustry = updatesOf(loadStatus()).find((u) => u.asset.startsWith("CBLV4"))!;
    feed.entries.set(ustry.asset, { ...ustry, as_of: ustry.as_of - 10n, issuer_change_seen_at: ustry.issuer_change_seen_at + 5n, version: 1, published_ledger: 1 });
    const err = await refusal(OPTS, deps);
    expect(err).toMatchObject({ precondition: 6 });
    expect(err.message).toMatch(/ChangeTimeWentBack/);
  });

  it("a stale dry run shows what the contract says, then refuses", async () => {
    const { feed, deps, lines } = setup();
    const updates = updatesOf(loadStatus());
    feed.entries.set(updates[0].asset, { ...updates[0], as_of: updates[0].as_of + 100n, version: 1, published_ledger: 1 });
    feed.failSimulationFor.set(updates[0].asset, new FeedError("contract error #30 (StaleAsOf)", "contract", 30));
    const err = await refusal({ ...OPTS, dryRun: true }, deps);
    expect(err).toMatchObject({ precondition: 6 });
    expect(lines.join("\n")).toContain("contract error #30 (StaleAsOf)");
    expect(feed.calls.publishBatch).toHaveLength(0);
  });
});

describe("precondition 7: batches", () => {
  it("stops at the first failed batch and logs only what was sent", async () => {
    const { feed, deps, records, lines } = setup();
    feed.failBatch = { n: 2, error: new FeedError("contract error #31 (AlreadyPublished)", "contract", 31) };
    const summary = await runPublish({ ...OPTS, batchSize: 10 }, deps);
    expect(feed.calls.publishBatch.map((b) => b.length)).toEqual([10, 10]); // batch 3 never tried
    expect(summary.ok).toBe(false);
    expect(summary.failure).toMatchObject({ code: 31, errorName: "AlreadyPublished" });
    expect(summary.published).toHaveLength(10);
    expect(records).toHaveLength(1);
    expect(records[0].assets).toHaveLength(10);
    expect(summary.verify).toBeNull();
    expect(lines.join("\n")).toContain("Stopped. Sent so far: 10 entries in 1 transactions.");
  });

  it("refuses a real run when the publisher has no XLM, before sending", async () => {
    const { feed, deps } = setup();
    feed.balance = 1n;
    expect(await refusal(OPTS, deps)).toMatchObject({ precondition: 7 });
    expect(feed.calls.publishBatch).toHaveLength(0);
  });

  it("rethrows an error that is not a FeedError instead of hiding it", async () => {
    const { feed, deps } = setup();
    feed.publishBatch = async () => { throw new TypeError("boom"); };
    await expect(runPublish(OPTS, deps)).rejects.toThrow("boom");
  });
});

describe("--dry-run", () => {
  it("simulates every batch, signs and sends nothing, and writes no log", async () => {
    const { feed, deps, records, lines } = setup();
    const summary = await runPublish({ ...OPTS, dryRun: true, batchSize: 10 }, deps);
    expect(feed.calls.simulatePublish.map((b) => b.length)).toEqual([10, 10, 7]);
    expect(feed.calls.publishBatch).toHaveLength(0);
    expect(records).toHaveLength(0);
    expect(summary).toMatchObject({ ok: true, dryRun: true, txHashes: [], verify: null });
    expect(lines.filter((l) => l.includes("simulation OK"))).toHaveLength(3);
  });

  it("reports every failed batch, exits not ok, and still sends nothing", async () => {
    const { feed, deps, lines } = setup();
    const updates = updatesOf(loadStatus());
    feed.failSimulationFor.set(updates[0].asset, new FeedError("contract error #14 (UnknownFlagBits)", "contract", 14));
    const summary = await runPublish({ ...OPTS, dryRun: true, batchSize: 10 }, deps);
    expect(summary.ok).toBe(false);
    expect(feed.calls.simulatePublish).toHaveLength(3);
    expect(lines.join("\n")).toContain("UnknownFlagBits");
    expect(feed.calls.publishBatch).toHaveLength(0);
  });

  it("skips the balance check", async () => {
    const { feed, deps } = setup();
    feed.balance = 0n;
    expect((await runPublish({ ...OPTS, dryRun: true }, deps)).ok).toBe(true);
  });
});

describe("verify", () => {
  it("names a mismatch and a missing entry, and the table counts them", async () => {
    const { feed, deps } = setup();
    await runPublish(OPTS, deps);
    const updates = updatesOf(loadStatus());
    feed.entries.set(updates[1].asset, { ...updates[1], flags: 8, version: 1, published_ledger: 5 });
    feed.entries.delete(updates[2].asset);
    const rows = await verifyFile(loadStatus(), feed);
    expect(rows.filter((r) => !r.ok)).toHaveLength(2);
    const table = formatVerifyTable(rows);
    expect(table).toContain("MISMATCH");
    expect(table).toContain("no entry in the feed");
    expect(table).toContain(`flags 8 != ${updates[1].flags}`);
    expect(table).toContain("25 match, 2 mismatch");
    expect(table.split("\n")[0]).toMatch(/^ASSET\s+STATUS\s+FLAGS\s+AS_OF\s+LEDGER\s+RESULT$/);
  });

  it("flags a status file that does not recompute, instead of skipping it", async () => {
    const feed = fakeFeed();
    const json = loadStatusJson();
    json.assets[0].flags_bitmask = 3;
    const rows = await verifyFile(parseStatusFile(json), feed);
    expect(rows.find((r) => !r.ok)!.diffs[0]).toMatch(/recomputed hash/);
  });

  it("leaves unpublished assets out", async () => {
    const feed = fakeFeed();
    const file = parseStatusFile(withUnpublished(loadStatusJson(), "GOLD"));
    const rows = await verifyFile(file, feed);
    expect(rows).toHaveLength(26);
    expect(fileFieldsOf(file).feed_schema).toBe(1);
  });
});

describe("log file", () => {
  const dirs: string[] = [];
  afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
  const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "feedlog-")); dirs.push(d); return d; };
  const rec = (tx: string): LogRecord => ({ at: "2026-10-10T09:00:00.000Z", network: "testnet", contract_id: DEPLOYMENT.contract_id, tx_hash: tx, ledger: 1, status_file: STATUS_REL, status_sha256: "a".repeat(64), commit: "b".repeat(40), assets: [] });

  it("creates the folder and file, then appends to the array", () => {
    const file = path.join(tmp(), "feed", "log.json");
    appendLogFile(file, rec("1"));
    appendLogFile(file, rec("2"));
    const list = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(list.map((r: LogRecord) => r.tx_hash)).toEqual(["1", "2"]);
    expect(fs.readdirSync(path.dirname(file))).toEqual(["log.json"]);
  });

  it("refuses a log that is not an array", () => {
    const file = path.join(tmp(), "log.json");
    fs.writeFileSync(file, "{}");
    expect(() => appendLogFile(file, rec("1"))).toThrow(/JSON array/);
  });
});

describe("shellGit", () => {
  const dirs: string[] = [];
  afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

  it("tells a clean, a modified and an untracked file apart", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "feedgit-"));
    dirs.push(dir);
    const git = (...args: string[]) => execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@example.test", ...args], { stdio: "pipe" });
    git("init", "-q");
    fs.mkdirSync(path.join(dir, "data", "status"), { recursive: true });
    fs.writeFileSync(path.join(dir, "data/status/2026-10-08.json"), "{}\n");
    fs.writeFileSync(path.join(dir, "data/status/2026-10-09.json"), "{}\n");
    git("add", "data/status/2026-10-08.json");
    git("commit", "-q", "-m", "x");
    const sg = shellGit(dir);
    expect(sg.isTracked("data/status/2026-10-08.json")).toBe(true);
    expect(sg.isTracked("data/status/2026-10-09.json")).toBe(false);
    expect(sg.isModified("data/status/2026-10-08.json")).toBe(false);
    fs.appendFileSync(path.join(dir, "data/status/2026-10-08.json"), "\n");
    expect(sg.isModified("data/status/2026-10-08.json")).toBe(true);
    expect(sg.head()).toMatch(/^[0-9a-f]{40}$/);
  });
});
