import { describe, expect, it } from "vitest";
import { assertPublishTarget, checkDemoGuards, nextAsOf, runDemo, type DemoOptions } from "./demo";
import { ChainError, REASON } from "./market";
import { IDENTITIES, demoEvidenceHash } from "./records";
import { KeeperRefusal } from "./run";
import { DEPLOYMENT, IDS, KEYS, RECON, SCENARIO, SYNTH_KEY, UNIVERSE, putEntry, world, type World } from "./testkit";

const full: DemoOptions = { dryRun: false, fromStep: 0 };

describe("K5 demo: the whole script on a fresh world", () => {
  it("sends exactly the 8 transactions of steps 2, 3, 4, 5, 6, 9, 11, 12, in order and with the right signers", async () => {
    const w = world();
    const res = await runDemo(full, w.deps("demo"));
    expect(res.exitCode).toBe(0);
    expect(w.sent.map((s) => [s.method, s.identity])).toEqual([
      ["publish", IDENTITIES.writer], // 2
      ["resume_borrows", IDENTITIES.admin], // 3
      ["open_borrow", IDENTITIES.borrower], // 4
      ["publish", IDENTITIES.writer], // 5
      ["sync", IDENTITIES.keeper], // 6
      ["publish", IDENTITIES.writer], // 9
      ["resume_borrows", IDENTITIES.admin], // 11
      ["open_borrow", IDENTITIES.borrower], // 12
    ]);
    expect(w.sent.map((s) => s.contractId)).toEqual([IDS.demoFeed, IDS.demoMarket, IDS.demoMarket, IDS.demoFeed, IDS.demoMarket, IDS.demoFeed, IDS.demoMarket, IDS.demoMarket]);
    expect(res.steps.map((s) => s.step)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(res.steps.filter((s) => s.txHash).map((s) => s.step)).toEqual([2, 3, 4, 5, 6, 9, 11, 12]);
    // steps 1, 7 and 8 are simulations that must fail; step 10 sends nothing
    expect(w.simulated.map((s) => s.method)).toEqual(["resume_borrows", "open_borrow", "resume_borrows"]);
    const byStep = (n: number) => res.steps.find((s) => s.step === n)!;
    expect(byStep(1).result).toMatch(/PolicyBlocks.*NOT_COVERED/);
    expect(byStep(7).result).toMatch(/#20 \(BorrowsPaused\); nothing sent/);
    expect(byStep(8).result).toMatch(/#30 \(PolicyBlocks\); nothing sent/);
    expect(byStep(10).txHash).toBeNull();
    expect(byStep(6).result).toMatch(/BorrowsPaused event/);
    // end state: open again, two mock units borrowed
    const end = await w.reader(IDS.demoMarket).market(SYNTH_KEY);
    expect(end).toMatchObject({ borrow_enabled: true, reason: 0, total_borrowed: 2n });
  });

  it("never publishes to Recon's feed, and never to anything but the demo feed", async () => {
    const w = world();
    await runDemo(full, w.deps("demo"));
    expect(w.sent.filter((s) => s.method === "publish").every((s) => s.contractId === IDS.demoFeed)).toBe(true);
    expect(w.published.every((p) => p.feedId === IDS.demoFeed)).toBe(true);
    expect(w.feeds.get(IDS.reconFeed)!.size).toBe(0);
  });

  it("publishes the scenario's steps with deterministic evidence hashes and a strictly increasing as_of, even inside one second", async () => {
    const w = world(); // the fake clock does not move except when the code sleeps
    await runDemo(full, w.deps("demo"));
    expect(w.published.map((p) => [p.status, p.flags])).toEqual([[0, 0], [2, 1], [0, 0]]);
    const asOfs = w.published.map((p) => p.asOf);
    expect(asOfs[1]).toBeGreaterThan(asOfs[0]);
    expect(asOfs[2]).toBeGreaterThan(asOfs[1]);
    ["open", "critical", "clean"].forEach((id, i) => {
      expect(w.published[i].hash).toBe(demoEvidenceHash(SCENARIO.sha256, id as "open", asOfs[i]));
    });
    expect(new Set(w.published.map((p) => p.hash)).size).toBe(3);
  });

  it("logs every transaction with its step number, on the demo market", async () => {
    const w = world();
    await runDemo(full, w.deps("demo"));
    expect(w.logs.map((l) => [l.step, l.method])).toEqual([[2, "publish"], [3, "resume_borrows"], [4, "open_borrow"], [5, "publish"], [6, "sync"], [9, "publish"], [11, "resume_borrows"], [12, "open_borrow"]]);
    expect(w.logs.every((l) => l.market === "demo" && l.network === "testnet" && l.key === SYNTH_KEY)).toBe(true);
    expect(w.logs.map((l) => l.tx_hash)).toEqual(w.sent.map((s) => s.txHash));
    const sync = w.logs.find((l) => l.method === "sync")!;
    expect(sync).toMatchObject({ borrow_enabled_before: true, borrow_enabled_after: false, decision: { reason: REASON.STATUS } });
    expect(w.logs.find((l) => l.method === "publish")!.decision).toBeNull();
  });

  it("a second run starts by pausing the market a previous run left open (step 0) and skips step 1", async () => {
    const w = world();
    await runDemo(full, w.deps("demo"));
    w.sent.length = 0;
    w.simulated.length = 0;
    const res = await runDemo(full, w.deps("demo"));
    expect(res.exitCode).toBe(0);
    expect(w.sent.map((s) => s.method)).toEqual(["pause_borrows", "publish", "resume_borrows", "open_borrow", "publish", "sync", "publish", "resume_borrows", "open_borrow"]);
    expect(w.simulated.map((s) => s.method)).toEqual(["open_borrow", "resume_borrows"]); // steps 7 and 8; step 1 is for the first run only
    expect(res.steps.find((s) => s.step === 1)!.result).toMatch(/skipped/);
    // as_of stays strictly above the earlier run's
    const asOfs = w.published.map((p) => p.asOf);
    expect(asOfs).toEqual([...asOfs].sort((a, b) => (a < b ? -1 : 1)));
    expect(new Set(asOfs).size).toBe(6);
  });

  it("--dry-run runs the guards and the step 1 simulation only: nothing is signed or sent", async () => {
    const w = world();
    const res = await runDemo({ dryRun: true, fromStep: 0 }, w.deps("demo"));
    expect(res.exitCode).toBe(0);
    expect(w.signs).toBe(0);
    expect(w.sent).toEqual([]);
    expect(w.logs).toEqual([]);
    expect(w.simulated.map((s) => s.method)).toEqual(["resume_borrows"]);
    expect(w.lines.join("\n")).toContain(SYNTH_KEY);
  });

  it("--from-step resumes after a failure: a refused step 3 stops the run with 3, and a rerun from step 3 finishes", async () => {
    const w = world();
    w.failSend = { n: 2, error: new ChainError("contract error #30 (PolicyBlocks)", "contract", 30, "PolicyBlocks") };
    const first = await runDemo(full, w.deps("demo"));
    expect(first.exitCode).toBe(3);
    expect(first.message).toMatch(/--from-step/);
    expect(w.sent.map((s) => s.method)).toEqual(["publish"]);
    w.failSend = null;
    const second = await runDemo({ dryRun: false, fromStep: 3 }, w.deps("demo"));
    expect(second.exitCode).toBe(0);
    expect(w.sent.map((s) => s.method)).toEqual(["publish", "resume_borrows", "open_borrow", "publish", "sync", "publish", "resume_borrows", "open_borrow"]);
    expect(second.steps.map((s) => s.step)).not.toContain(2);
  });

  it("an unknown transaction outcome exits 2 and logs the hash with outcome unknown", async () => {
    const w = world();
    const hash = "cd".repeat(32);
    w.failSend = { n: 1, error: new ChainError(`Timed out waiting for transaction ${hash}`, "timeout", null, null, hash) };
    const res = await runDemo(full, w.deps("demo"));
    expect(res.exitCode).toBe(2);
    expect(w.logs).toHaveLength(1);
    expect(w.logs[0]).toMatchObject({ tx_hash: hash, ledger: null, outcome: "unknown", step: 2 });
  });

  it("step 6 fails (exit 3) if the keeper's transaction has no BorrowsPaused event", async () => {
    const w = world();
    const deps = w.deps("demo");
    const send = deps.send;
    const res = await runDemo(full, { ...deps, send: async (req) => (req.method === "sync" ? { ...(await send(req)), events: ["something_else"] } : send(req)) });
    expect(res.exitCode).toBe(3);
    expect(res.message).toMatch(/no BorrowsPaused event/);
  });

  it("step 3 fails (exit 3) if the market is not open after resume", async () => {
    const w = world();
    const deps = w.deps("demo");
    const res = await runDemo(full, { ...deps, send: async (req) => (req.method === "resume_borrows" ? { txHash: "ee".repeat(32), ledger: 1, returnValue: null, events: [] } : deps.send(req)) });
    expect(res.exitCode).toBe(3);
    expect(res.message).toMatch(/not open after resume_borrows/);
  });
});

describe("K5 demo: guards refuse before anything is signed (exit 1)", () => {
  const refused = async (w: World, over: Parameters<World["deps"]>[1] = {}) => {
    const res = await runDemo(full, w.deps("demo", over));
    expect(res.exitCode).toBe(1);
    expect(w.signs).toBe(0);
    expect(w.sent).toEqual([]);
    expect(w.logs).toEqual([]);
    return res.message ?? "";
  };

  it("a publish to Recon's feed ID is refused, and so is a publish to any other contract", () => {
    expect(() => assertPublishTarget(IDS.reconFeed, DEPLOYMENT, RECON)).toThrow(KeeperRefusal);
    expect(() => assertPublishTarget(IDS.reconFeed, DEPLOYMENT, RECON)).toThrow(/Recon's feed/);
    expect(() => assertPublishTarget(IDS.liveMarket, DEPLOYMENT, RECON)).toThrow(/not the demo feed/);
    expect(() => assertPublishTarget(IDS.demoFeed, DEPLOYMENT, RECON)).not.toThrow();
    // even when the record itself has been edited to name Recon's feed as the demo feed
    const edited = { ...DEPLOYMENT, demo_feed: { ...DEPLOYMENT.demo_feed, contract_id: IDS.reconFeed } };
    expect(() => assertPublishTarget(IDS.reconFeed, edited, RECON)).toThrow(/Recon's feed/);
  });

  it("a record that makes the demo feed Recon's feed is refused", async () => {
    const w = world();
    const edited = {
      ...DEPLOYMENT,
      markets: { ...DEPLOYMENT.markets, demo: { ...DEPLOYMENT.markets.demo, feed: IDS.reconFeed } },
      demo_feed: { ...DEPLOYMENT.demo_feed, contract_id: IDS.reconFeed },
    };
    w.markets.get(IDS.demoMarket)!.feed = IDS.reconFeed;
    await refused(w, { deployment: edited });
    expect(w.published).toEqual([]);
  });

  it("the demo feed's publisher or admin equals Recon's", async () => {
    const w = world();
    w.feedRoles.set(IDS.demoFeed, { admin: KEYS.writer, publisher: KEYS.reconPublisher, schema: 1 });
    expect(await refused(w)).toMatch(/publisher or admin is Recon's/);
    const w2 = world();
    w2.feedRoles.set(IDS.demoFeed, { admin: KEYS.reconAdmin, publisher: KEYS.writer, schema: 1 });
    expect(await refused(w2)).toMatch(/publisher or admin is Recon's/);
  });

  it("the demo feed's publisher or admin is not the writer", async () => {
    const w = world();
    w.feedRoles.set(IDS.demoFeed, { admin: KEYS.writer, publisher: KEYS.admin, schema: 1 });
    expect(await refused(w)).toMatch(/publisher\(\) is .*not the writer/);
    const w2 = world();
    w2.feedRoles.set(IDS.demoFeed, { admin: KEYS.admin, publisher: KEYS.writer, schema: 1 });
    expect(await refused(w2)).toMatch(/admin\(\) is .*not the writer/);
  });

  it("the demo feed holds a key other than SYNTH, or Recon's feed holds SYNTH", async () => {
    const w = world();
    putEntry(w, IDS.demoFeed, UNIVERSE[0].sac_contract_id);
    expect(await refused(w)).toMatch(/holds a key other than the synthetic one/);
    const w2 = world();
    putEntry(w2, IDS.reconFeed, SYNTH_KEY);
    expect(await refused(w2)).toMatch(/Recon's feed holds the synthetic key/);
  });

  it("the demo feed may hold exactly the SYNTH key", async () => {
    const w = world();
    putEntry(w, IDS.demoFeed, SYNTH_KEY);
    await expect(checkDemoGuards(w.deps("demo"))).resolves.toBeUndefined();
  });

  it("a SYNTH key found in assets.csv is refused", async () => {
    const w = world();
    const msg = await refused(w, { universe: [...UNIVERSE, { asset_code: "ZZZ", issuer: KEYS.admin, sac_contract_id: SYNTH_KEY }] });
    expect(msg).toMatch(/is in data\/assets.csv/);
  });

  it("an identity whose public key is not the record's", async () => {
    const w = world();
    w.identities[IDENTITIES.writer] = KEYS.borrower;
    expect(await refused(w)).toMatch(/identity demo-feed-writer is .*not the record's/);
    const w2 = world();
    w2.identities[IDENTITIES.admin] = KEYS.borrower;
    expect(await refused(w2)).toMatch(/identity lending-admin is .*not the record's/);
    const w3 = world();
    w3.identities[IDENTITIES.borrower] = KEYS.admin;
    expect(await refused(w3)).toMatch(/identity lending-borrower is .*not the record's/);
  });

  it("the §4.3 preconditions apply to the demo too (wrong passphrase)", async () => {
    const w = world();
    w.passphrase = "Public Global Stellar Network ; September 2015";
    expect(await refused(w)).toMatch(/not testnet/);
  });
});

describe("K5 nextAsOf", () => {
  const clock = (start: number) => {
    const c = { t: start, slept: 0, now: () => new Date(c.t * 1000), sleep: async (ms: number) => void ((c.t += ms / 1000), (c.slept += 1)) };
    return c;
  };

  it("uses the clock when it is already past the stored value", async () => {
    const c = clock(1000);
    expect(await nextAsOf(c, 999n)).toBe(1000n);
    expect(await nextAsOf(c, null)).toBe(1000n);
    expect(c.slept).toBe(0);
  });

  it("waits one second at a time until the clock is strictly above the stored value", async () => {
    const c = clock(1000);
    expect(await nextAsOf(c, 1000n)).toBe(1001n);
    expect(await nextAsOf(c, 1003n)).toBe(1004n);
    expect(c.slept).toBe(4);
  });

  it("gives up when the stored value is far ahead of the clock", async () => {
    await expect(nextAsOf(clock(1000), 5000n)).rejects.toThrow(/ahead of the clock/);
  });

  it("successive values from a stalled clock are strictly increasing", async () => {
    const c = { t: 50, now: () => new Date(50_000), sleep: async () => {} };
    // a clock that never moves can never get past the stored value: the helper refuses instead of looping
    await expect(nextAsOf(c, 50n)).rejects.toThrow(KeeperRefusal);
  });
});

describe("K7 demo output", () => {
  it("says SYNTHETIC, names the one mock unit, and has no banned word, grade, or amount", async () => {
    const w = world();
    await runDemo(full, w.deps("demo"));
    const text = w.lines.join("\n");
    expect(text).not.toMatch(/unsafe|risky|fraud|scam|rating|score|price/i);
    expect(text).not.toMatch(/\b(XLM|lumens?|USD[A-Z]*|stroops?)\b|[$€£]/i);
    expect(text).toMatch(/SYNTHETIC/);
    expect(text).toMatch(/open_borrow 1 mock unit/);
    expect(text).toMatch(/not Recon's feed/);
    // every amount in the output is the mock unit
    expect([...text.matchAll(/\b(\d+) mock unit/g)].map((m) => m[1])).toEqual(["1", "1"]);
    expect(text).toContain("https://stellar.expert/explorer/testnet/tx/");
  });
});
