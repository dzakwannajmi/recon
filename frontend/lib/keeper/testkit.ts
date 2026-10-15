/**
 * Test helpers for the keeper: fixture records and an in-memory world (a feed, a market, a clock, a log) that
 * follows the market's decision order from spec 3. No network, no process, no keys but public test seeds.
 * Test support only: nothing in the app or the scripts imports this file.
 */
import { Address, Asset, Keypair, Networks, StrKey, scValToNative, type xdr } from "@stellar/stellar-sdk";
import type { Entry } from "../feed/encode";
import type { Roles } from "../feed/reader";
import type { KeeperLogRecord } from "./log";
import { ChainError, FEED_STATUS_NAMES, MARKET_ERROR_NAMES, REASON, type Decision, type MarketReader, type MarketState } from "./market";
import {
  DEMO_PURPOSE, IDENTITIES, parseScenario, syntheticKey,
  type KeeperDeployment, type LoadedScenario, type MarketRecord, type UniverseRow,
} from "./records";
import type { DemoDeps } from "./demo";
import type { InvokeRequest, InvokeResult } from "./send";
import { FEED_ERROR_NAMES } from "../feed/encode";

/** Public test seeds, not secrets. */
export const kp = (n: number) => Keypair.fromRawEd25519Seed(Buffer.alloc(32, n));
export const KEYS = {
  admin: kp(11).publicKey(),
  keeper: kp(12).publicKey(),
  borrower: kp(13).publicKey(),
  writer: kp(14).publicKey(),
  reconPublisher: kp(15).publicKey(),
  reconAdmin: kp(16).publicKey(),
};
export const KEYPAIRS = { keeper: kp(12), writer: kp(14), admin: kp(11), borrower: kp(13), other: kp(17) };
export const contractId = (n: number) => StrKey.encodeContract(Buffer.alloc(32, n));
export const IDS = {
  reconFeed: contractId(1),
  demoFeed: contractId(2),
  liveMarket: contractId(3),
  demoMarket: contractId(4),
};

/** Two real-looking assets in the fake `assets.csv`: keys are the mainnet SAC IDs, as in the real file. */
const issuerA = kp(21).publicKey();
const issuerB = kp(22).publicKey();
export const UNIVERSE: UniverseRow[] = [
  { asset_code: "BENJI", issuer: issuerA, sac_contract_id: new Asset("BENJI", issuerA).contractId(Networks.PUBLIC) },
  { asset_code: "USTRY", issuer: issuerB, sac_contract_id: new Asset("USTRY", issuerB).contractId(Networks.PUBLIC) },
];
export const BENJI_KEY = UNIVERSE[0].sac_contract_id;
export const USTRY_KEY = UNIVERSE[1].sac_contract_id;
export const SYNTH_KEY = syntheticKey("SYNTH", KEYS.writer);

export const RECON = { contract_id: IDS.reconFeed, admin: KEYS.reconAdmin, publisher: KEYS.reconPublisher };

const marketRecord = (id: string, feed: string, assets: MarketRecord["assets"]): MarketRecord => ({
  contract_id: id, deploy_tx: "ab".repeat(32), deployed_at: "2026-10-16T00:00:00.000Z", feed, pause_at: 2, max_age_secs: 691_200, assets,
});

export const DEPLOYMENT: KeeperDeployment = {
  network: "testnet",
  sdk: "29.0.0",
  lending_wasm_hash: "cd".repeat(32),
  admin: KEYS.admin,
  keeper: KEYS.keeper,
  borrower: KEYS.borrower,
  markets: {
    live: marketRecord(IDS.liveMarket, IDS.reconFeed, [
      { label: "BENJI", asset: `BENJI:${issuerA}`, key: BENJI_KEY },
      { label: "USTRY", asset: `USTRY:${issuerB}`, key: USTRY_KEY },
    ]),
    demo: marketRecord(IDS.demoMarket, IDS.demoFeed, [{ label: "SYNTH (synthetic, testnet only)", asset: null, key: SYNTH_KEY }]),
  },
  demo_feed: {
    contract_id: IDS.demoFeed, deploy_tx: "ef".repeat(32), deployed_at: "2026-10-16T00:00:00.000Z", wasm_hash: "92".repeat(32), writer: KEYS.writer, purpose: DEMO_PURPOSE,
  },
};

export const SCENARIO_TEXT = JSON.stringify({
  purpose: "Synthetic test data for the keeper demo. Not a finding about any asset.",
  code: "SYNTH",
  issuer: KEYS.writer,
  steps: [{ id: "open", status: 0, flags: 0 }, { id: "critical", status: 2, flags: 1 }, { id: "clean", status: 0, flags: 0 }],
}, null, 2) + "\n";
export const SCENARIO: LoadedScenario = parseScenario(SCENARIO_TEXT);

export const NOW_SECONDS = 1_792_000_000; // 2026-10-14, a fixed clock for tests

export const entry = (key: string, over: Partial<Entry> = {}): Entry => ({
  asset: key, version: 1, status: 0, flags: 0, evidence_hash: "11".repeat(32), as_of: BigInt(NOW_SECONDS - 3600), issuer_change_seen_at: 0n, published_ledger: 500, ...over,
});

type MarketData = { feed: string; admin: string; policy: { pause_at: number; max_age: bigint }; states: Map<string, MarketState> };

export type World = {
  nowSeconds: number;
  feeds: Map<string, Map<string, Entry>>;
  feedRoles: Map<string, Roles>;
  markets: Map<string, MarketData>;
  identities: Record<string, string>;
  balance: bigint;
  passphrase: string;
  /** Every transaction the world accepted, in order. */
  sent: { contractId: string; method: string; source: string; identity: string; txHash: string }[];
  simulated: { contractId: string; method: string; source: string }[];
  signs: number;
  /** Every entry written to a feed, in order. */
  published: { feedId: string; asset: string; status: number; flags: number; asOf: bigint; hash: string }[];
  logs: KeeperLogRecord[];
  lines: string[];
  /** Make the nth (1-based) send fail with this error. */
  failSend: { n: number; error: ChainError } | null;
  rpcUrl: string;
  /** Feed reads for these feed IDs fail (the market reports FEED_UNAVAILABLE). */
  brokenFeeds: Set<string>;
  reader(marketId: string): MarketReader;
  decide(marketId: string, key: string): Decision;
  deps(market: "live" | "demo", over?: Partial<DemoDeps>): DemoDeps;
};

const zeroHash = "00".repeat(32);

export function world(): World {
  const w: World = {
    nowSeconds: NOW_SECONDS,
    feeds: new Map([[IDS.reconFeed, new Map()], [IDS.demoFeed, new Map()]]),
    feedRoles: new Map([
      [IDS.reconFeed, { admin: KEYS.reconAdmin, publisher: KEYS.reconPublisher, schema: 1 }],
      [IDS.demoFeed, { admin: KEYS.writer, publisher: KEYS.writer, schema: 1 }],
    ]),
    markets: new Map([
      [IDS.liveMarket, { feed: IDS.reconFeed, admin: KEYS.admin, policy: { pause_at: 2, max_age: 691_200n }, states: new Map([BENJI_KEY, USTRY_KEY].map((k) => [k, { borrow_enabled: true, reason: 0, changed_ledger: 1, total_borrowed: 0n }])) }],
      [IDS.demoMarket, { feed: IDS.demoFeed, admin: KEYS.admin, policy: { pause_at: 2, max_age: 691_200n }, states: new Map([[SYNTH_KEY, { borrow_enabled: false, reason: REASON.LISTED, changed_ledger: 1, total_borrowed: 0n }]]) }],
    ]),
    identities: { [IDENTITIES.admin]: KEYS.admin, [IDENTITIES.keeper]: KEYS.keeper, [IDENTITIES.borrower]: KEYS.borrower, [IDENTITIES.writer]: KEYS.writer },
    balance: 1_000_000_000n,
    passphrase: Networks.TESTNET,
    sent: [], simulated: [], signs: 0, published: [], logs: [], lines: [],
    failSend: null,
    rpcUrl: "https://soroban-testnet.stellar.org",
    brokenFeeds: new Set(),
    decide(marketId, key) {
      const m = w.markets.get(marketId) as MarketData;
      const none = (reason: number): Decision => ({ reason, status: 0, flags: 0, as_of: 0n, evidence_hash: zeroHash, published_ledger: 0 });
      if (w.brokenFeeds.has(m.feed)) return none(REASON.FEED_UNAVAILABLE);
      const e = w.feeds.get(m.feed)?.get(key);
      if (!e) return none(REASON.NOT_COVERED);
      const copy = (reason: number): Decision => ({ reason, status: e.status, flags: e.flags, as_of: e.as_of, evidence_hash: e.evidence_hash, published_ledger: e.published_ledger });
      if (e.version !== 1 || e.status > 2) return copy(REASON.UNKNOWN_SCHEMA);
      if (e.status >= m.policy.pause_at) return copy(REASON.STATUS);
      if (BigInt(w.nowSeconds) - e.as_of > m.policy.max_age) return copy(REASON.STALE);
      return copy(REASON.CLEAR);
    },
    reader(marketId) {
      const m = () => w.markets.get(marketId) as MarketData;
      return {
        check: async (key) => w.decide(marketId, key),
        market: async (key) => {
          const s = m().states.get(key);
          return s ? { ...s } : null; // a copy, as a decoded ScVal would be
        },
        markets: async () => [...m().states.keys()],
        feed: async () => m().feed,
        admin: async () => m().admin,
        policy: async () => m().policy,
      };
    },
    deps(market, over = {}) {
      const marketId = DEPLOYMENT.markets[market].contract_id;
      const apply = (req: InvokeRequest | Omit<InvokeRequest, "identity">, effects: boolean): InvokeResult | void => {
        const own = req.contractId;
        if (!effects) w.simulated.push({ contractId: own, method: req.method, source: req.source });
        const arg = (i: number): any => scValToNative(req.args[i] as xdr.ScVal);
        const m = w.markets.get(own);
        const feed = w.feeds.get(own);
        const fail = (code: number, names: Record<number, string>) => {
          throw new ChainError(`contract error #${code} (${names[code]})`, "contract", code, names[code]);
        };
        let events: string[] = [];
        if (feed) {
          if (req.method !== "publish") throw new Error(`test: unexpected feed method ${req.method}`);
          if (req.source !== (w.feedRoles.get(own) as Roles).publisher) throw new ChainError("not the publisher", "simulation");
          for (const u of arg(0) as { asset: string; status: number; flags: number; evidence_hash: Uint8Array; as_of: bigint; issuer_change_seen_at: bigint }[]) {
            const stored = feed.get(u.asset);
            const hash = Buffer.from(u.evidence_hash).toString("hex");
            if (stored && u.as_of < stored.as_of) fail(30, FEED_ERROR_NAMES);
            if (stored && u.as_of === stored.as_of && hash === stored.evidence_hash) fail(31, FEED_ERROR_NAMES);
            if (u.as_of > BigInt(w.nowSeconds) + 300n) fail(19, FEED_ERROR_NAMES);
            if (effects) w.published.push({ feedId: own, asset: u.asset, status: u.status, flags: u.flags, asOf: u.as_of, hash });
            if (effects) feed.set(u.asset, { asset: u.asset, version: 1, status: u.status, flags: u.flags, evidence_hash: hash, as_of: u.as_of, issuer_change_seen_at: u.issuer_change_seen_at, published_ledger: 700 + w.sent.length });
          }
        } else if (m) {
          const key: string = req.method === "open_borrow" ? arg(1) : arg(0);
          const state = m.states.get(key);
          if (!state) fail(13, MARKET_ERROR_NAMES);
          const s = state as MarketState;
          const d = w.decide(own, key);
          if (req.method === "sync") {
            if (d.reason !== REASON.CLEAR && s.borrow_enabled) {
              events = ["borrows_paused"];
              if (effects) Object.assign(s, { borrow_enabled: false, reason: d.reason });
            }
          } else if (req.method === "resume_borrows") {
            if (req.source !== m.admin) throw new ChainError("not the admin", "simulation");
            if (d.reason !== REASON.CLEAR) fail(30, MARKET_ERROR_NAMES);
            if (effects) Object.assign(s, { borrow_enabled: true, reason: 0 });
          } else if (req.method === "pause_borrows") {
            if (req.source !== m.admin) throw new ChainError("not the admin", "simulation");
            if (effects && s.borrow_enabled) Object.assign(s, { borrow_enabled: false, reason: REASON.MANUAL });
          } else if (req.method === "open_borrow") {
            if (!s.borrow_enabled) fail(20, MARKET_ERROR_NAMES);
            if (effects) s.total_borrowed += arg(2) as bigint;
          } else throw new Error(`test: unexpected market method ${req.method}`);
        } else throw new Error(`test: unknown contract ${own}`);
        if (!effects) return;
        const identity = (req as InvokeRequest).identity;
        if (w.identities[identity] !== req.source) throw new Error(`test: identity ${identity} is not the source ${req.source}`);
        const txHash = (w.sent.length + 1).toString(16).padStart(64, "0");
        w.sent.push({ contractId: own, method: req.method, source: req.source, identity, txHash });
        w.signs += 1;
        return { txHash, ledger: 900 + w.sent.length, returnValue: null, events };
      };
      return {
        deployment: DEPLOYMENT,
        scenario: SCENARIO.scenario,
        scenarioSha256: SCENARIO.sha256,
        recon: RECON,
        universe: UNIVERSE,
        rpcUrl: w.rpcUrl,
        env: {},
        rpc: {
          getNetwork: async () => ({ passphrase: w.passphrase }),
          getAccountEntry: async () => ({ balance: w.balance }),
        },
        market: w.reader(marketId),
        readEntries: async (feedId, keys) => keys.map((k) => w.feeds.get(feedId)?.get(k) ?? null),
        feedRoles: async (feedId) => w.feedRoles.get(feedId) as Roles,
        feedAssets: async (feedId) => [...(w.feeds.get(feedId)?.keys() ?? [])],
        publicKeyOf: (identity) => w.identities[identity],
        send: async (req) => {
          if (w.failSend && w.failSend.n === w.sent.length + 1) throw w.failSend.error;
          return apply(req, true) as InvokeResult;
        },
        simulate: async (req) => void apply(req, false),
        notEvaluated: (key) => (key === BENJI_KEY ? { file: "2026-10-09.json", flags: ["LARGE_MINT_BURN", "PRICE_DEVIATION"] } : null),
        appendLog: (r) => void w.logs.push(r),
        sleep: async (ms) => void (w.nowSeconds += ms / 1000),
        now: () => new Date(w.nowSeconds * 1000),
        out: (line) => void w.lines.push(line),
        ...over,
      };
    },
  };
  return w;
}

/** Put a feed entry in the world. */
export function putEntry(w: World, feedId: string, key: string, over: Partial<Entry> = {}): Entry {
  const e = entry(key, over);
  (w.feeds.get(feedId) as Map<string, Entry>).set(key, e);
  return e;
}

export { FEED_STATUS_NAMES };
