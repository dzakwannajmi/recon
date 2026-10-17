/**
 * Horizon reads for the Monitor (D-047, spec 4.3). Read-only, mainnet, one fixed origin. Every
 * request counts toward the run budget and is paced. A paging link is followed only when it points
 * at the same origin. Nothing here writes, signs, or reads a secret.
 */
import { totalSupply, formatStroops } from "../chain/asset";
import { HORIZON_MAINNET, isHorizonUrl, type AssetRecord } from "../chain/horizon";
import { FetchError, fetchTrustedJson } from "../chain/http";
import { horizonEffectSchema, horizonOpSchema, opLedger, type HorizonEffect, type HorizonOp, type Point } from "./types";
import { z } from "zod";

export class BudgetExhausted extends Error {
  constructor() { super("Horizon request budget for this run is used up."); }
}

export type PinnedAsset = { code: string; issuer: string };
export const assetKeyOf = (a: PinnedAsset) => `${a.code}:${a.issuer}`;

export type SupplyReads = {
  points: Map<string, Point>;
  /** Asset key -> why there is no point this run. */
  failures: Map<string, string>;
  budgetEnded: boolean;
};

export type OpsRequest =
  | { mode: "forward"; cursor: string; maxPages: number }
  /** Page backwards from the newest op until an op older than `since` (ISO) or the end of history. */
  | { mode: "backfill"; since: string; maxPages: number };

export type OpsRead = {
  /** Oldest first. */
  ops: HorizonOp[];
  /** The paging token to continue from (the newest op read), or null when no op was read. */
  newestCursor: string | null;
  /** The issuer's ops are complete through this ledger / time, or null when nothing can be claimed. */
  coveredThroughLedger: number | null;
  coveredThroughAt: string | null;
  /** Backfill only: ops are complete from this time on. */
  coveredFrom: string | null;
  caughtUp: boolean;
  partial: boolean;
  error: string | null;
  pages: number;
};

/** What the Monitor needs from Horizon. The real client and the demo's fake both implement it. */
export interface HorizonSource {
  /** Requests used so far in this run. */
  readonly requests: number;
  remaining(): number;
  readSupplyPoints(assets: readonly PinnedAsset[]): Promise<SupplyReads>;
  readIssuerOps(issuer: string, req: OpsRequest): Promise<OpsRead>;
  /** The effects of one operation, or null when they cannot be read (budget, error). */
  readOpEffects(opId: string): Promise<HorizonEffect[] | null>;
}

const PAGE_LIMIT = 200;
const PACE_MS = 250;
const RETRY_MS = 2000;
const ACCOUNT = /^G[A-Z2-7]{55}$/;
const CODE = /^[A-Za-z0-9]{1,12}$/;

const rootSchema = z.object({ history_latest_ledger: z.number().int().positive(), history_latest_ledger_closed_at: z.string() }).loose();
const assetPageSchema = z.object({
  _embedded: z.object({
    records: z.array(z.object({
      asset_code: z.string(), asset_issuer: z.string(),
      balances: z.object({ authorized: z.string() }).loose(),
    }).loose()),
  }),
}).loose();
const opsPageSchema = z.object({
  _embedded: z.object({ records: z.array(z.unknown()) }),
  _links: z.object({ next: z.object({ href: z.string() }).loose().optional() }).loose().optional(),
}).loose();
const effectsPageSchema = z.object({ _embedded: z.object({ records: z.array(z.unknown()) }) }).loose();

export type ClientOptions = {
  maxRequests: number;
  fetchJson?: (url: string) => Promise<unknown>;
  sleep?: (ms: number) => Promise<void>;
  paceMs?: number;
  retryMs?: number;
};

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createHorizonClient(opts: ClientOptions): HorizonSource {
  const fetchJson = opts.fetchJson ?? ((url: string) => fetchTrustedJson<unknown>(url, { timeoutMs: 10_000 }));
  const sleep = opts.sleep ?? realSleep;
  const pace = opts.paceMs ?? PACE_MS;
  const retryMs = opts.retryMs ?? RETRY_MS;
  let used = 0;
  let last = false;

  /** One counted request. `paced` = wait before it (not inside a supply point's root-asset-root bracket). */
  async function request(url: string, paced: boolean): Promise<unknown> {
    const once = async () => {
      if (used >= opts.maxRequests) throw new BudgetExhausted();
      if (paced && last) await sleep(pace);
      used++;
      last = true;
      return fetchJson(url);
    };
    try {
      return await once();
    } catch (err) {
      if (err instanceof BudgetExhausted) throw err;
      // 429 and 5xx: one retry after a pause, then give up for this run.
      if (!(err instanceof FetchError) || !/^HTTP (429|5\d\d)\b/.test(err.message)) throw err;
      await sleep(retryMs);
      return once();
    }
  }

  const root = async (paced: boolean) => {
    const r = rootSchema.parse(await request(`${HORIZON_MAINNET}/`, paced));
    return { ledger: r.history_latest_ledger, closed_at: r.history_latest_ledger_closed_at };
  };

  async function assetRecord(a: PinnedAsset): Promise<AssetRecord | null> {
    if (!CODE.test(a.code) || !ACCOUNT.test(a.issuer)) throw new Error(`refusing to read an invalid asset: ${a.code}`);
    const url = `${HORIZON_MAINNET}/assets?asset_code=${encodeURIComponent(a.code)}&asset_issuer=${encodeURIComponent(a.issuer)}&limit=1`;
    const page = assetPageSchema.parse(await request(url, false));
    const rec = page._embedded.records[0];
    // Horizon matches the code case-insensitively in some views; the record must match exactly.
    return rec && rec.asset_code === a.code && rec.asset_issuer === a.issuer ? (rec as unknown as AssetRecord) : null;
  }

  async function readSupplyPoints(assets: readonly PinnedAsset[]): Promise<SupplyReads> {
    const out: SupplyReads = { points: new Map(), failures: new Map(), budgetEnded: false };
    try {
      let before = await root(true);
      for (const a of assets) {
        const key = assetKeyOf(a);
        try {
          // A point is precise when the ledger did not move while the asset was read (root before and after agree).
          for (let attempt = 0; attempt < 3 && !out.points.has(key) && !out.failures.has(key); attempt++) {
            const rec = await assetRecord(a);
            const after = await root(false);
            if (!rec) { out.failures.set(key, "asset not found"); }
            else if (before.ledger === after.ledger) {
              out.points.set(key, { ledger: after.ledger, at: after.closed_at, supply: formatStroops(totalSupply(rec).total), source: "monitor" });
            }
            before = after;
          }
          if (!out.points.has(key) && !out.failures.has(key)) out.failures.set(key, "ledger moved during the read three times");
        } catch (err) {
          if (err instanceof BudgetExhausted) throw err;
          out.failures.set(key, err instanceof Error ? err.message : String(err));
          before = await root(false); // restart the bracket after an error
        }
      }
    } catch (err) {
      if (!(err instanceof BudgetExhausted)) throw err;
      out.budgetEnded = true;
    }
    return out;
  }

  /** Records of one page, validated; the next link only when it stays on the Horizon origin. */
  function parsePage(raw: unknown): { ops: HorizonOp[]; next: string | null; size: number } {
    const page = opsPageSchema.parse(raw);
    const ops = page._embedded.records.map((r) => horizonOpSchema.parse(r));
    const next = page._links?.next?.href ?? null;
    return { ops, next, size: page._embedded.records.length };
  }

  async function readIssuerOps(issuer: string, req: OpsRequest): Promise<OpsRead> {
    const read: OpsRead = {
      ops: [], newestCursor: null, coveredThroughLedger: null, coveredThroughAt: null, coveredFrom: null, caughtUp: false, partial: false, error: null, pages: 0,
    };
    if (!ACCOUNT.test(issuer)) return { ...read, partial: true, error: "invalid issuer account" };
    const base = `${HORIZON_MAINNET}/accounts/${issuer}/operations?include_failed=false&limit=${PAGE_LIMIT}`;
    let rootNow: { ledger: number; closed_at: string };
    try {
      rootNow = await root(true);
    } catch (err) {
      return { ...read, partial: true, error: err instanceof Error ? err.message : String(err) };
    }
    const forward = req.mode === "forward";
    let url: string | null = forward ? `${base}&order=asc&cursor=${encodeURIComponent(req.cursor)}` : `${base}&order=desc`;
    const since = req.mode === "backfill" ? Date.parse(req.since) : 0;
    const collected: HorizonOp[] = [];
    let reachedEnd = false;
    try {
      while (url) {
        if (read.pages >= req.maxPages) { read.partial = true; break; }
        const { ops, next, size } = parsePage(await request(url, true));
        read.pages++;
        if (forward) {
          collected.push(...ops);
        } else {
          let cut = false;
          for (const o of ops) {
            if (Date.parse(o.created_at) < since) { cut = true; break; }
            collected.push(o);
          }
          if (cut) { reachedEnd = true; break; }
        }
        if (size < PAGE_LIMIT) { reachedEnd = true; break; }
        if (next === null) { read.partial = true; read.error = "paging link missing"; break; }
        if (!isHorizonUrl(next)) { read.partial = true; read.error = "paging link points outside Horizon"; break; }
        url = next;
      }
    } catch (err) {
      read.partial = true;
      if (!(err instanceof BudgetExhausted)) read.error = err instanceof Error ? err.message : String(err);
    }

    read.ops = forward ? collected : collected.reverse();
    // Coverage. Caught up: everything through the root ledger read before paging. Otherwise: through the ledger before the last op read.
    if (forward) {
      if (reachedEnd && !read.partial) {
        read.caughtUp = true;
        read.coveredThroughLedger = rootNow.ledger;
        read.coveredThroughAt = rootNow.closed_at;
      } else if (read.ops.length > 0) {
        const lastOp = read.ops[read.ops.length - 1];
        read.coveredThroughLedger = opLedger(lastOp) - 1;
        read.coveredThroughAt = new Date(Date.parse(lastOp.created_at) - 1000).toISOString();
      }
    } else if (read.pages > 0) {
      // The first page is the newest: the head is covered through the root ledger read before it, as long as it was read.
      read.caughtUp = true;
      read.coveredThroughLedger = rootNow.ledger;
      read.coveredThroughAt = rootNow.closed_at;
      if (reachedEnd) read.coveredFrom = req.mode === "backfill" ? req.since : null;
      else if (read.ops.length > 0) read.coveredFrom = read.ops[0].created_at;
    }
    if (read.ops.length > 0) read.newestCursor = read.ops[read.ops.length - 1].paging_token;
    if (read.caughtUp) {
      // Caught up through the root ledger: continue after the last operation of that ledger (a TOID boundary), so a quiet issuer is not read again.
      const boundary = (BigInt(rootNow.ledger + 1) << 32n) - 1n;
      if (read.newestCursor === null || BigInt(read.newestCursor) < boundary) read.newestCursor = boundary.toString();
    }
    return read;
  }

  async function readOpEffects(opId: string): Promise<HorizonEffect[] | null> {
    if (!/^\d+$/.test(opId)) return null;
    try {
      const page = effectsPageSchema.parse(await request(`${HORIZON_MAINNET}/operations/${opId}/effects?limit=${PAGE_LIMIT}`, true));
      return page._embedded.records.map((r) => horizonEffectSchema.parse(r));
    } catch {
      return null; // budget used up or an error: the caller counts the op as unclassified
    }
  }

  return {
    get requests() { return used; },
    remaining: () => opts.maxRequests - used,
    readSupplyPoints,
    readIssuerOps,
    readOpEffects,
  };
}
