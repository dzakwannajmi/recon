import { describe, expect, it } from "vitest";
import { ChainError, REASON, addressToScVal } from "./market";
import { IDENTITIES } from "./records";
import { loadDeployment as loadReconFeed } from "../feed/deployment";
import { FEED_WASM_HASH, RECON_FEED_ID } from "./records";
import { MIN_KEEPER_BALANCE_STROOPS, KeeperRefusal, assertExecutable, entryMismatch, explorerTxUrl, formatAge, guardedSend, runKeeper, type KeeperOptions } from "./run";
import { BENJI_KEY, DEPLOYMENT, IDS, KEYS, SYNTH_KEY, USTRY_KEY, entry, putEntry, world, type World } from "./testkit";

const live = (over: Partial<KeeperOptions> = {}): KeeperOptions => ({ market: "live", dryRun: false, sendAll: false, ...over });

/** The live market with BENJI OK and USTRY WARNING (neither pauses under pause_at 2). */
function liveWorld(): World {
  const w = world();
  putEntry(w, IDS.reconFeed, BENJI_KEY, { status: 0, flags: 0 });
  putEntry(w, IDS.reconFeed, USTRY_KEY, { status: 1, flags: 8, issuer_change_seen_at: 1n, evidence_hash: "22".repeat(32) });
  return w;
}

describe("K3 runKeeper: the plan", () => {
  it("sends nothing when every policy passes (OK and WARNING stay open under pause_at 2)", async () => {
    const w = liveWorld();
    const res = await runKeeper(live(), w.deps("live"));
    expect(res.exitCode).toBe(0);
    expect(w.sent).toEqual([]);
    expect(res.rows.map((r) => [r.label, r.decision.reason, r.action])).toEqual([["BENJI", REASON.CLEAR, "none"], ["USTRY", REASON.CLEAR, "none"]]);
    expect(w.logs).toEqual([]);
  });

  it("sends sync only for the asset whose reason is not CLEAR and whose market is open", async () => {
    const w = liveWorld();
    putEntry(w, IDS.reconFeed, USTRY_KEY, { status: 2, flags: 1, evidence_hash: "33".repeat(32) });
    const res = await runKeeper(live(), w.deps("live"));
    expect(res.exitCode).toBe(0);
    expect(w.sent.map((s) => [s.method, s.contractId, s.source, s.identity])).toEqual([["sync", IDS.liveMarket, KEYS.keeper, IDENTITIES.keeper]]);
    const [row] = res.rows.filter((r) => r.action === "sync");
    expect([row.label, row.decision.reason, row.before.borrow_enabled, row.after.borrow_enabled, row.after.reason]).toEqual(["USTRY", REASON.STATUS, true, false, REASON.STATUS]);
    expect(row.events).toEqual(["borrows_paused"]);
  });

  it("does not send for an asset that is already paused, nor for a CLEAR asset that is paused", async () => {
    const w = liveWorld();
    putEntry(w, IDS.reconFeed, USTRY_KEY, { status: 2, flags: 1, evidence_hash: "33".repeat(32) });
    Object.assign(w.markets.get(IDS.liveMarket)!.states.get(USTRY_KEY)!, { borrow_enabled: false, reason: REASON.STATUS });
    Object.assign(w.markets.get(IDS.liveMarket)!.states.get(BENJI_KEY)!, { borrow_enabled: false, reason: REASON.LISTED });
    const res = await runKeeper(live(), w.deps("live"));
    expect(res.exitCode).toBe(0);
    expect(w.sent).toEqual([]);
  });

  it("a missing entry (NOT_COVERED) on an open market is a pause", async () => {
    const w = liveWorld();
    w.feeds.get(IDS.reconFeed)!.delete(BENJI_KEY);
    const res = await runKeeper(live(), w.deps("live"));
    expect(res.rows[0]).toMatchObject({ label: "BENJI", action: "sync" });
    expect(res.rows[0].decision.reason).toBe(REASON.NOT_COVERED);
    expect(w.sent).toHaveLength(1);
  });

  it("a stale entry (older than the market's limit) is a pause", async () => {
    const w = liveWorld();
    putEntry(w, IDS.reconFeed, BENJI_KEY, { as_of: BigInt(w.nowSeconds - 9 * 86_400) });
    const res = await runKeeper(live(), w.deps("live"));
    expect(res.rows[0].decision.reason).toBe(REASON.STALE);
    expect(res.rows[0].action).toBe("sync");
  });

  it("--send-all sends sync for every asset, paused or not, and still logs each one", async () => {
    const w = liveWorld();
    const res = await runKeeper(live({ sendAll: true }), w.deps("live"));
    expect(res.exitCode).toBe(0);
    expect(w.sent.map((s) => s.method)).toEqual(["sync", "sync"]);
    expect(res.rows.every((r) => r.action === "sync" && r.txHash)).toBe(true);
    expect(w.logs.map((l) => l.asset_label)).toEqual(["BENJI", "USTRY"]);
    // no pause happened: sync cannot enable and the policy passes
    expect(res.rows.map((r) => r.after.borrow_enabled)).toEqual([true, true]);
  });

  it("--dry-run simulates and never calls the signer, sends, or logs", async () => {
    const w = liveWorld();
    putEntry(w, IDS.reconFeed, USTRY_KEY, { status: 2, flags: 1, evidence_hash: "33".repeat(32) });
    const res = await runKeeper(live({ dryRun: true, sendAll: true }), w.deps("live"));
    expect(res.exitCode).toBe(0);
    expect(w.signs).toBe(0);
    expect(w.sent).toEqual([]);
    expect(w.logs).toEqual([]);
    expect(w.simulated.map((s) => s.method)).toEqual(["sync", "sync"]);
    expect(w.simulated.every((s) => s.source === KEYS.keeper)).toBe(true);
    expect(res.rows.every((r) => r.action === "dry-run" && r.txHash === null)).toBe(true);
    expect(w.lines.join("\n")).toContain("nothing is signed");
  });

  it("a dry run whose simulation fails on an open market exits 4 (could not evaluate) without signing", async () => {
    const w = liveWorld();
    const deps = w.deps("live", { simulate: async () => { throw new ChainError("contract error #13 (NotListed)", "contract", 13, "NotListed"); } });
    const res = await runKeeper(live({ dryRun: true, sendAll: true }), deps);
    expect(res.exitCode).toBe(4);
    expect(w.signs).toBe(0);
    expect(w.lines).toContain("could not evaluate BENJI; the market may be open; follow runbook 5.11: lending-admin runs pause_borrows");
  });
});

describe("K3 runKeeper: the log and the exit codes", () => {
  it("logs one record per transaction with the decision and the open/paused state before and after", async () => {
    const w = liveWorld();
    putEntry(w, IDS.reconFeed, USTRY_KEY, { status: 2, flags: 1, evidence_hash: "33".repeat(32) });
    await runKeeper(live(), w.deps("live"));
    expect(w.logs).toHaveLength(1);
    expect(w.logs[0]).toMatchObject({
      network: "testnet", market: "live", contract_id: IDS.liveMarket, method: "sync", asset_label: "USTRY", key: USTRY_KEY,
      tx_hash: w.sent[0].txHash, ledger: 901, borrow_enabled_before: true, borrow_enabled_after: false,
      decision: { reason: REASON.STATUS, reason_name: "STATUS", status: 2, flags: 1 },
    });
    expect(Object.keys(w.logs[0]).sort()).toEqual(["asset_label", "at", "borrow_enabled_after", "borrow_enabled_before", "contract_id", "decision", "key", "ledger", "market", "method", "network", "tx_hash"]);
  });

  it("a failed transaction stops the run with exit 3 and does not send the next one", async () => {
    const w = liveWorld();
    w.failSend = { n: 1, error: new ChainError("contract error #13 (NotListed)", "contract", 13, "NotListed") };
    const res = await runKeeper(live({ sendAll: true }), w.deps("live"));
    expect(res.exitCode).toBe(3);
    expect(w.sent).toEqual([]);
    expect(w.logs).toEqual([]);
  });

  it("an unknown outcome exits 2, logs the hash with outcome unknown, and is not re-sent", async () => {
    const w = liveWorld();
    const hash = "ab".repeat(32);
    w.failSend = { n: 1, error: new ChainError(`Timed out waiting for transaction ${hash}`, "timeout", null, null, hash) };
    const res = await runKeeper(live({ sendAll: true }), w.deps("live"));
    expect(res.exitCode).toBe(2);
    expect(w.sent).toEqual([]);
    expect(w.logs).toHaveLength(1);
    expect(w.logs[0]).toMatchObject({ tx_hash: hash, ledger: null, outcome: "unknown", borrow_enabled_after: null });
    expect(w.lines.join("\n")).toContain(explorerTxUrl(hash));
  });
});

describe("K4 preconditions: each refusal exits 1 before anything is signed", () => {
  const refused = async (w: World, over: Parameters<World["deps"]>[1] = {}, opts: KeeperOptions = live({ sendAll: true })) => {
    const res = await runKeeper(opts, w.deps(opts.market, over));
    expect(res.exitCode).toBe(1);
    expect(w.signs).toBe(0);
    expect(w.sent).toEqual([]);
    expect(w.logs).toEqual([]);
    return res.message ?? "";
  };

  it("wrong passphrase", async () => {
    const w = liveWorld();
    w.passphrase = "Public Global Stellar Network ; September 2015";
    expect(await refused(w)).toMatch(/not testnet/);
  });

  it("an RPC host that is not on the testnet allowlist, or plain http", async () => {
    const w = liveWorld();
    w.rpcUrl = "https://mainnet.sorobanrpc.com";
    expect(await refused(w)).toMatch(/not on the testnet allowlist/);
    const w2 = liveWorld();
    w2.rpcUrl = "http://soroban-testnet.stellar.org";
    expect(await refused(w2)).toMatch(/https/);
  });

  it("a record that says a network other than testnet", async () => {
    const w = liveWorld();
    expect(await refused(w, { deployment: { ...DEPLOYMENT, network: "mainnet" as never } })).toMatch(/only testnet is allowed/);
  });

  it("feed() on chain is not the record's feed", async () => {
    const w = liveWorld();
    w.markets.get(IDS.liveMarket)!.feed = IDS.demoFeed;
    expect(await refused(w)).toMatch(/feed\(\) is .*not the record's/);
  });

  it("the live record points at a feed that is not Recon's", async () => {
    const w = liveWorld();
    const bad = { ...DEPLOYMENT, markets: { ...DEPLOYMENT.markets, live: { ...DEPLOYMENT.markets.live, feed: IDS.demoFeed } } };
    expect(await refused(w, { deployment: bad })).toMatch(/not Recon's feed/);
  });

  it("the demo market reads Recon's feed", async () => {
    const w = world();
    const bad = {
      ...DEPLOYMENT,
      markets: { ...DEPLOYMENT.markets, demo: { ...DEPLOYMENT.markets.demo, feed: IDS.reconFeed } },
      demo_feed: { ...DEPLOYMENT.demo_feed, contract_id: IDS.reconFeed },
    };
    expect(await refused(w, { deployment: bad }, { market: "demo", dryRun: false, sendAll: false })).toMatch(/demo feed is Recon's feed/);
  });

  it("a key equal to Recon's publisher or admin", async () => {
    const w = liveWorld();
    expect(await refused(w, { deployment: { ...DEPLOYMENT, keeper: KEYS.reconPublisher } })).toMatch(/same account/);
    expect(await refused(liveWorld(), { deployment: { ...DEPLOYMENT, admin: KEYS.reconAdmin } })).toMatch(/same account/);
    const w3 = liveWorld();
    expect(await refused(w3, { deployment: { ...DEPLOYMENT, borrower: KEYS.reconPublisher } })).toMatch(/same account/);
  });

  it("admin() or markets() on chain differ from the record", async () => {
    const w = liveWorld();
    w.markets.get(IDS.liveMarket)!.admin = KEYS.writer;
    expect(await refused(w)).toMatch(/admin\(\) is/);
    const w2 = liveWorld();
    w2.markets.get(IDS.liveMarket)!.states.delete(USTRY_KEY);
    expect(await refused(w2)).toMatch(/markets\(\) are not the assets in the record/);
    const w3 = liveWorld();
    w3.markets.get(IDS.liveMarket)!.states.set(SYNTH_KEY, { borrow_enabled: false, reason: 10, changed_ledger: 1, total_borrowed: 0n });
    expect(await refused(w3)).toMatch(/markets\(\) are not the assets in the record/);
  });

  it("the keeper identity is not the record's keeper, or the balance is too low", async () => {
    const w = liveWorld();
    w.identities[IDENTITIES.keeper] = KEYS.borrower;
    expect(await refused(w)).toMatch(/not the record's keeper/);
    const w2 = liveWorld();
    w2.balance = MIN_KEEPER_BALANCE_STROOPS - 1n;
    expect(await refused(w2)).toMatch(/too little balance/);
  });

  it("the off-chain entry differs from the decision, or exists when the market says NOT_COVERED", async () => {
    const w = liveWorld();
    const real = w.deps("live");
    const tampered = {
      readEntries: async (feedId: string, keys: readonly string[]) =>
        (await real.readEntries(feedId, keys)).map((e) => (e ? { ...e, evidence_hash: "ff".repeat(32) } : e)),
    };
    expect(await refused(w, tampered)).toMatch(/differs from the market's decision: evidence_hash differs/);
    const w2 = liveWorld();
    w2.feeds.get(IDS.reconFeed)!.delete(USTRY_KEY); // the market holds a decision from an entry, the feed has none
    const real2 = w2.deps("live");
    const statusDecision = { reason: REASON.STATUS, status: 2, flags: 1, as_of: 1n, evidence_hash: "11".repeat(32), published_ledger: 1 };
    expect(await refused(w2, { market: { ...real2.market, check: async (k: string) => (k === USTRY_KEY ? statusDecision : real2.market.check(k)) } })).toMatch(/the feed has none/);
  });

  it("a market that is not listed", async () => {
    const w = liveWorld();
    const real = w.deps("live");
    expect(await refused(w, { market: { ...real.market, market: async () => null } })).toMatch(/not listed/);
  });

  it("an RPC failure during the checks is a refusal, not a crash", async () => {
    const w = liveWorld();
    const real = w.deps("live");
    expect(await refused(w, { market: { ...real.market, feed: async () => { throw new Error("rpc down"); } } })).toMatch(/rpc down/);
  });
});

describe("entryMismatch", () => {
  const e = entry(BENJI_KEY, { status: 2, flags: 1, as_of: 5n, evidence_hash: "aa".repeat(32), published_ledger: 9 });
  const d = { reason: REASON.STATUS, status: 2, flags: 1, as_of: 5n, evidence_hash: "aa".repeat(32), published_ledger: 9 };
  it("agrees when every copied field is equal", () => {
    expect(entryMismatch(d, e)).toBeNull();
    expect(entryMismatch({ ...d, reason: 0, status: 0, flags: 0, as_of: 0n, evidence_hash: "00".repeat(32), published_ledger: 0, }, null)).toMatch(/feed has none/);
  });
  it("names each field that differs", () => {
    expect(entryMismatch({ ...d, status: 1 }, e)).toMatch(/status 2 != 1/);
    expect(entryMismatch({ ...d, flags: 0 }, e)).toMatch(/flags 1 != 0/);
    expect(entryMismatch({ ...d, as_of: 6n }, e)).toMatch(/as_of 5 != 6/);
    expect(entryMismatch({ ...d, published_ledger: 1 }, e)).toMatch(/published_ledger 9 != 1/);
  });
});

describe("K7 output", () => {
  const BANNED = /unsafe|risky|fraud|scam|rating|score|price/i;
  const MONEY = /\b(XLM|lumens?|USD[A-Z]*|stroops?|EUR[A-Z]*)\b|[$€£]|\d\s*(XLM|USD)/i;

  it("a live run uses the allowed words and has no banned word, grade, or amount", async () => {
    const w = liveWorld();
    putEntry(w, IDS.reconFeed, USTRY_KEY, { status: 2, flags: 1, evidence_hash: "33".repeat(32) });
    await runKeeper(live({ sendAll: true }), w.deps("live"));
    const text = w.lines.join("\n");
    // The not-evaluated line prints flag identifiers from the status file verbatim; those are data (PRICE_DEVIATION is a flag name).
    const own = w.lines.filter((l) => !l.includes("not evaluated (from the status file"));
    expect(own.join("\n")).not.toMatch(BANNED);
    expect(text).not.toMatch(MONEY);
    expect(text).toMatch(/feed status OK/);
    expect(text).toMatch(/feed status CRITICAL/);
    expect(text).toMatch(/market policy STATUS/);
    expect(text).toMatch(/open → paused/);
    expect(text).toContain("https://stellar.expert/explorer/testnet/tx/");
  });

  it("the not-evaluated line is marked as coming from the status file and holds identifiers only", async () => {
    const w = liveWorld();
    await runKeeper(live(), w.deps("live"));
    const line = w.lines.find((l) => l.includes("not evaluated"))!;
    expect(line).toMatch(/BENJI not evaluated \(from the status file 2026-10-09\.json, not on chain\): LARGE_MINT_BURN, PRICE_DEVIATION$/);
    expect(w.lines.filter((l) => l.includes("not evaluated"))).toHaveLength(1); // USTRY has none
  });

  it("a demo-market run starts every row with SYNTHETIC and shows no not-evaluated line", async () => {
    const w = world();
    putEntry(w, IDS.demoFeed, SYNTH_KEY, { status: 2, flags: 1 });
    const res = await runKeeper({ market: "demo", dryRun: false, sendAll: false }, w.deps("demo"));
    expect(res.exitCode).toBe(0);
    const rows = w.lines.filter((l) => l.includes("market policy"));
    expect(rows).toHaveLength(1);
    expect(rows[0].startsWith("SYNTHETIC ")).toBe(true);
    expect(w.lines.join("\n")).not.toMatch(/not evaluated/);
  });

  it("formats an age", () => {
    expect(formatAge(59)).toBe("0m");
    expect(formatAge(3 * 3600 + 120)).toBe("3h 2m");
    expect(formatAge(2 * 86_400 + 5 * 3600)).toBe("2d 5h");
    expect(formatAge(-5)).toBe("0m");
  });
});


describe("K4 executable hash: each refusal exits 1 before anything is signed", () => {
  const refusedWith = async (w: World, expected: RegExp) => {
    const res = await runKeeper(live({ sendAll: true }), w.deps("live"));
    expect(res.exitCode).toBe(1);
    expect(res.message ?? "").toMatch(expected);
    expect(w.signs).toBe(0);
    expect(w.sent).toEqual([]);
    expect(w.logs).toEqual([]);
  };

  it("passes when the market and its feed run the expected Wasm", async () => {
    const w = liveWorld();
    const res = await runKeeper(live(), w.deps("live"));
    expect(res.exitCode).toBe(0);
  });

  it("the market's feed runs another Wasm", async () => {
    const w = liveWorld();
    w.executables.set(IDS.reconFeed, { kind: "wasm", hash: "aa".repeat(32) });
    await refusedWith(w, /the market's feed .* runs Wasm aa+, not the expected 92b5af7e/);
  });

  it("the market itself runs another Wasm", async () => {
    const w = liveWorld();
    w.executables.set(IDS.liveMarket, { kind: "wasm", hash: "bb".repeat(32) });
    await refusedWith(w, /the market .* runs Wasm bb+, not the expected cd/);
  });

  it("the feed address is a Stellar Asset Contract", async () => {
    const w = liveWorld();
    w.executables.set(IDS.reconFeed, { kind: "asset" });
    await refusedWith(w, /does not run a Wasm \(contractExecutableStellarAsset\)/);
  });

  it("the instance entry is missing", async () => {
    const w = liveWorld();
    w.executables.set(IDS.liveMarket, null);
    await refusedWith(w, /has no contract instance on chain/);
    const w2 = liveWorld();
    w2.executables.set(IDS.reconFeed, null);
    await refusedWith(w2, /has no contract instance on chain/);
  });

  it("an RPC error reading the entry is a refusal too", async () => {
    const w = liveWorld();
    const real = w.deps("live");
    const res = await runKeeper(live(), { ...real, rpc: { ...real.rpc, getLedgerEntries: async () => { throw new Error("rpc down"); } } });
    expect(res.exitCode).toBe(1);
    expect(res.message).toMatch(/could not read the executable of the market .*rpc down/);
  });

  it("assertExecutable reads a real instance entry (SDK XDR objects)", async () => {
    const w = liveWorld();
    const rpc = w.deps("live").rpc;
    await expect(assertExecutable(rpc, IDS.reconFeed, FEED_WASM_HASH, "feed")).resolves.toBeUndefined();
    await expect(assertExecutable(rpc, IDS.reconFeed, "00".repeat(32), "feed")).rejects.toThrow(KeeperRefusal);
  });
});

describe("HIGH 2 fail-safe: an unreadable asset never blocks a pause, and never hides an open market", () => {
  it("FEED_UNAVAILABLE: an off-chain read error counts as consistent and sync is sent", async () => {
    const w = liveWorld();
    w.brokenFeeds.add(IDS.reconFeed);
    const deps = w.deps("live", { readEntries: async () => { throw new Error("feed read failed"); } });
    const res = await runKeeper(live(), deps);
    expect(res.exitCode).toBe(0);
    expect(res.rows.map((r) => [r.label, r.decision.reason, r.action, r.after.borrow_enabled, r.after.reason])).toEqual([
      ["BENJI", REASON.FEED_UNAVAILABLE, "sync", false, REASON.FEED_UNAVAILABLE],
      ["USTRY", REASON.FEED_UNAVAILABLE, "sync", false, REASON.FEED_UNAVAILABLE],
    ]);
    expect(w.sent.map((s) => s.method)).toEqual(["sync", "sync"]);
  });

  it("FEED_UNAVAILABLE with a readable entry is also consistent: the market's own call failed and sync can only pause", async () => {
    const w = liveWorld();
    w.brokenFeeds.add(IDS.reconFeed);
    const res = await runKeeper(live(), w.deps("live"));
    expect(res.exitCode).toBe(0);
    expect(w.sent).toHaveLength(2);
  });

  it("UNKNOWN_SCHEMA: a decoding error off chain counts as consistent and sync is sent", async () => {
    const w = liveWorld();
    putEntry(w, IDS.reconFeed, BENJI_KEY, { version: 2 });
    const deps = w.deps("live", { readEntries: async () => { throw new Error("Entry.status is not a u32"); } });
    const res = await runKeeper(live(), deps);
    // BENJI is paused by sync; USTRY is CLEAR with an unreadable entry on an open market, so the run ends with exit 4.
    expect(res.exitCode).toBe(4);
    expect(res.rows.find((r) => r.label === "BENJI")).toMatchObject({ action: "sync" });
    expect(res.rows.find((r) => r.label === "BENJI")!.decision.reason).toBe(REASON.UNKNOWN_SCHEMA);
    expect(w.sent.map((s) => s.method)).toEqual(["sync"]);
  });

  it("check() throws on an open market: exit 4 with the runbook line, nothing signed", async () => {
    const w = liveWorld();
    const real = w.deps("live");
    const res = await runKeeper(live(), { ...real, market: { ...real.market, check: async () => { throw new Error("simulation failed"); } } });
    expect(res.exitCode).toBe(4);
    expect(w.signs).toBe(0);
    expect(w.lines).toContain("could not evaluate BENJI; the market may be open; follow runbook 5.11: lending-admin runs pause_borrows");
    expect(w.lines).toContain("could not evaluate USTRY; the market may be open; follow runbook 5.11: lending-admin runs pause_borrows");
  });

  it("market() throws: the state is unknown, so exit 4", async () => {
    const w = liveWorld();
    const real = w.deps("live");
    const res = await runKeeper(live(), { ...real, market: { ...real.market, market: async () => { throw new Error("rpc down"); } } });
    expect(res.exitCode).toBe(4);
    expect(w.lines.filter((l) => l.startsWith("could not evaluate"))).toHaveLength(2);
  });

  it("check() throws but the market is known to be paused: no exit 4", async () => {
    const w = liveWorld();
    for (const s of w.markets.get(IDS.liveMarket)!.states.values()) Object.assign(s, { borrow_enabled: false, reason: REASON.STATUS });
    const real = w.deps("live");
    const res = await runKeeper(live(), { ...real, market: { ...real.market, check: async () => { throw new Error("simulation failed"); } } });
    expect(res.exitCode).toBe(0);
    expect(w.lines.some((l) => l.includes("could not evaluate BENJI; the market is paused"))).toBe(true);
  });

  it("one unreadable asset does not stop the pause of another: sync is sent, then exit 4", async () => {
    const w = liveWorld();
    putEntry(w, IDS.reconFeed, USTRY_KEY, { status: 2, flags: 1, evidence_hash: "33".repeat(32) });
    const real = w.deps("live");
    const res = await runKeeper(live(), { ...real, market: { ...real.market, check: async (k: string) => { if (k === BENJI_KEY) throw new Error("boom"); return real.market.check(k); } } });
    expect(res.exitCode).toBe(4);
    expect(w.sent.map((s) => s.method)).toEqual(["sync"]);
    expect(res.rows.map((r) => [r.label, r.action])).toEqual([["USTRY", "sync"]]);
    expect(w.lines.some((l) => l.startsWith("could not evaluate BENJI"))).toBe(true);
  });

  it("a CLEAR decision whose entry can't be cross-checked, with the market open, is exit 4", async () => {
    const w = liveWorld();
    const res = await runKeeper(live(), w.deps("live", { readEntries: async () => { throw new Error("decode"); } }));
    expect(res.exitCode).toBe(4);
    expect(w.signs).toBe(0);
  });

  it("record and identity refusals stay exit 1 (not 4)", async () => {
    const w = liveWorld();
    w.identities[IDENTITIES.keeper] = KEYS.borrower;
    expect((await runKeeper(live(), w.deps("live"))).exitCode).toBe(1);
  });
});

describe("MEDIUM (a): the hash survives a failed re-read, and an on-chain failure is logged", () => {
  it("market() throws after a successful send: logged with the hash and ledger, borrow_enabled_after null, exit 3", async () => {
    const w = liveWorld();
    putEntry(w, IDS.reconFeed, USTRY_KEY, { status: 2, flags: 1, evidence_hash: "33".repeat(32) });
    const real = w.deps("live");
    const res = await runKeeper(live(), { ...real, market: { ...real.market, market: async (k: string) => { if (w.sent.length > 0) throw new Error("rpc down"); return real.market.market(k); } } });
    expect(res.exitCode).toBe(3);
    expect(w.sent).toHaveLength(1);
    expect(w.logs).toHaveLength(1);
    expect(w.logs[0]).toMatchObject({ tx_hash: w.sent[0].txHash, ledger: 901, borrow_enabled_before: true, borrow_enabled_after: null });
    expect(w.logs[0].outcome).toBeUndefined();
    expect(res.message).toContain(w.sent[0].txHash);
  });

  it("a transaction that fails on chain is logged with outcome failed and exit 3", async () => {
    const w = liveWorld();
    const hash = "ab".repeat(32);
    w.failSend = { n: 1, error: new ChainError(`Transaction ${hash} failed on chain`, "failed", null, null, hash) };
    const res = await runKeeper(live({ sendAll: true }), w.deps("live"));
    expect(res.exitCode).toBe(3);
    expect(w.logs).toHaveLength(1);
    expect(w.logs[0]).toMatchObject({ tx_hash: hash, ledger: null, outcome: "failed", borrow_enabled_after: null });
    expect(res.message).toMatch(/runbook 5.11/);
  });

  it("a refused transaction (never on chain) is not logged", async () => {
    const w = liveWorld();
    w.failSend = { n: 1, error: new ChainError("The network refused the transaction (ERROR)", "rejected", null, null, "cd".repeat(32)) };
    const res = await runKeeper(live({ sendAll: true }), w.deps("live"));
    expect(res.exitCode).toBe(3);
    expect(w.logs).toEqual([]);
  });
});

describe("MEDIUM (b): Recon's feed", () => {
  it("RECON_FEED_ID and FEED_WASM_HASH are the values in data/feed/deployment.json", () => {
    expect(RECON_FEED_ID).toBe(loadReconFeed().contract_id);
    expect(FEED_WASM_HASH).toBe(loadReconFeed().wasm_hash);
  });

  it("guardedSend refuses any method to Recon's feed, by the constant and by the record, and passes others through", async () => {
    const w = liveWorld();
    const deps = w.deps("live");
    for (const method of ["publish", "set_publisher", "upgrade", "sync", "anything"]) {
      await expect(guardedSend(deps, { contractId: RECON_FEED_ID, method, args: [], source: KEYS.keeper, identity: IDENTITIES.keeper, errorNames: {} })).rejects.toThrow(KeeperRefusal);
      await expect(guardedSend(deps, { contractId: deps.recon.contract_id, method, args: [], source: KEYS.keeper, identity: IDENTITIES.keeper, errorNames: {} })).rejects.toThrow(/never writes to it/);
    }
    expect(w.sent).toEqual([]);
    const ok = await guardedSend(deps, { contractId: IDS.liveMarket, method: "sync", args: [addressToScVal(BENJI_KEY)], source: KEYS.keeper, identity: IDENTITIES.keeper, errorNames: {} });
    expect(ok.txHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("a keeper identity equal to Recon's feed admin or publisher on chain is refused, whatever data/feed/deployment.json says", async () => {
    for (const roles of [{ admin: KEYS.admin, publisher: KEYS.reconPublisher }, { admin: KEYS.reconAdmin, publisher: KEYS.keeper }, { admin: KEYS.borrower, publisher: KEYS.reconPublisher }, { admin: KEYS.reconAdmin, publisher: KEYS.writer }]) {
      const w = liveWorld();
      w.feedRoles.set(IDS.reconFeed, { ...roles, schema: 1 });
      const res = await runKeeper(live({ sendAll: true }), w.deps("live"));
      expect(res.exitCode).toBe(1);
      expect(res.message).toMatch(/is the publisher or admin of Recon's feed on chain/);
      expect(w.signs).toBe(0);
    }
  });
});
