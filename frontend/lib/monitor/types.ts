/**
 * Monitor types (D-047, spec 3.1). Amounts are decimal strings with 7 decimals and are
 * parsed with `toStroops`; nothing in the Monitor computes with floats.
 * Everything fetched from Horizon is data: it is validated here and never followed as an instruction.
 */
import { z } from "zod";

/** One Horizon operation. Only the fields every type shares are required; unknown fields pass through. */
export const horizonOpSchema = z.object({
  id: z.string().regex(/^\d+$/),
  paging_token: z.string().regex(/^\d+$/),
  type: z.string(),
  transaction_successful: z.boolean(),
  source_account: z.string(),
  created_at: z.string().refine((s) => Number.isFinite(Date.parse(s)), "created_at is not a time"),
  transaction_hash: z.string().regex(/^[0-9a-f]{64}$/),
}).loose();
export type HorizonOp = z.infer<typeof horizonOpSchema>;

/** One effect of an operation (`/operations/{id}/effects`). */
export const horizonEffectSchema = z.object({ type: z.string(), account: z.string().optional() }).loose();
export type HorizonEffect = z.infer<typeof horizonEffectSchema>;

/** The ledger of an operation: the TOID in its paging token is `ledger << 32 | tx << 12 | op`. */
export const opLedger = (op: Pick<HorizonOp, "paging_token">): number => Number(BigInt(op.paging_token) >> 32n);

/** A string field of an op, or undefined when it is missing or not a string. */
export const field = (op: Record<string, unknown>, name: string): string | undefined => {
  const v = op[name];
  return typeof v === "string" ? v : undefined;
};

/** A supply reading of one asset. Precise points have a ledger; a point from a checks file has a time only. */
export type Point = {
  ledger: number | null;
  /** Close time of the ledger (precise) or `facts.checkedAt` (from a checks file). */
  at: string;
  /** Decimal string, 7 decimals (the D-020 total supply). */
  supply: string;
  source: "monitor" | "checks";
};

/** One top transaction of a day, by size. */
export type TopTx = { tx: string; side: "mint" | "burn"; amount: string };

/** Mint and burn sums of one UTC day. */
export type DayAgg = { minted: string; burned: string; ops: number; top_tx: TopTx[] };

/** The classified ops between two consecutive points. `explained` = the supply difference equals the classified net, exactly. */
export type Interval = {
  from: Point;
  to: Point;
  explained: boolean;
  /** Ops that touched the asset in a way the classifier cannot size (offers, pools, claims without effects). */
  unclassified: number;
  by_day: Record<string, DayAgg>;
};

export type OpenInterval = { from_point: Point; by_day: Record<string, DayAgg>; unclassified: number };

export type AssetState = {
  /** At most 40, oldest first. */
  points: Point[];
  intervals: Interval[];
  open: OpenInterval | null;
  intraday: { date: string; minted: string; burned: string };
  /** `YYYY-MM-DD:side` keys of large intraday events already raised. */
  large_seen: string[];
};

export type IssuerState = {
  cursor: string | null;
  /** Ops are complete from this time on (backfill cut-off), or null before the first read. */
  covered_from: string | null;
  covered_through_ledger: number | null;
  covered_through_at: string | null;
};

export type PendingEvent = { event_id: string; assets: string[]; ledger_closed_at: string };

export type MonitorState = {
  version: 1;
  issuers: Record<string, IssuerState>;
  assets: Record<string, AssetState>;
  pending: PendingEvent[];
};

export type EventType = "issuer_options" | "issuer_merged" | "large_mint_burn" | "supply_unreconciled";

/** What the Monitor saw. A trigger only: the deciders over the new checks file set any flag. */
export type IssuerEvent = {
  kind: "event";
  id: string;
  seen_at: string;
  type: EventType;
  issuer: string;
  assets: string[];
  ledger: number | null;
  ledger_closed_at: string;
  tx_hash?: string;
  op_id?: string;
  changes?: string[];
  side?: "mint" | "burn";
  amount?: string;
  base?: string;
  share?: string;
  synthetic?: true;
};

export type RunOutcome = "ran" | "deferred" | "failed" | "watch_only";

export type RunRecord = {
  kind: "run";
  at: string;
  day: string;
  reasons: string[];
  outcome: RunOutcome;
  deferred?: { reason: string; until: string | null };
  steps?: { step: string; exit_code: number; ms: number }[];
  files?: { path: string; sha256: string }[];
  diff?: StatusDiff;
  horizon_requests: number;
  partial_issuers: string[];
  synthetic?: true;
};

export type LogRecord = IssuerEvent | RunRecord;

export type StatusDiffItem = {
  asset: string;
  status_from: string | null;
  status_to: string | null;
  bitmask_from: number;
  bitmask_to: number;
  raised: string[];
  cleared: string[];
};
export type StatusDiff = { against: string | null; items: StatusDiffItem[] };

export type IssuanceDay = { date: string; minted: string; burned: string; supply_end: string; ops: number; top_tx: TopTx[] };
export type MissingDay = { date: string; reason: "not_covered" | "not_reconciled" };
export type IssuanceAsset = {
  asset: string;
  supply_points: Point[];
  intervals: { from: Point; to: Point; explained: boolean; unclassified: number }[];
  days: IssuanceDay[];
  missing: MissingDay[];
};
export type IssuanceFile = {
  monitor_version: 1;
  generated_at: string;
  day: string;
  window: { from: string; to: string };
  horizon: string;
  assets: IssuanceAsset[];
};

// ---- state file schema (data/monitor/state.json) ----

const amount = z.string().regex(/^\d+\.\d{7}$/);
const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/);
const pointSchema = z.object({ ledger: z.number().int().nonnegative().nullable(), at: iso, supply: amount, source: z.enum(["monitor", "checks"]) }).strict();
const topTxSchema = z.object({ tx: z.string(), side: z.enum(["mint", "burn"]), amount }).strict();
const dayAggSchema = z.object({ minted: amount, burned: amount, ops: z.number().int().nonnegative(), top_tx: z.array(topTxSchema).max(5) }).strict();
const byDaySchema = z.record(z.string().regex(/^\d{4}-\d{2}-\d{2}$/), dayAggSchema);

export const stateSchema = z.object({
  version: z.literal(1),
  issuers: z.record(z.string(), z.object({
    cursor: z.string().regex(/^\d+$/).nullable(),
    covered_from: iso.nullable(),
    covered_through_ledger: z.number().int().nonnegative().nullable(),
    covered_through_at: iso.nullable(),
  }).strict()),
  assets: z.record(z.string(), z.object({
    points: z.array(pointSchema).max(40),
    intervals: z.array(z.object({
      from: pointSchema, to: pointSchema, explained: z.boolean(), unclassified: z.number().int().nonnegative(), by_day: byDaySchema,
    }).strict()).max(40),
    open: z.object({ from_point: pointSchema, by_day: byDaySchema, unclassified: z.number().int().nonnegative() }).strict().nullable(),
    intraday: z.object({ date: z.string(), minted: amount, burned: amount }).strict(),
    large_seen: z.array(z.string()),
  }).strict()),
  pending: z.array(z.object({ event_id: z.string(), assets: z.array(z.string()), ledger_closed_at: iso }).strict()),
}).strict();

export const MAX_POINTS = 40;
export const MAX_INTERVALS = 40;
