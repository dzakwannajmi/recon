/**
 * Classify one Horizon operation of a pinned issuer (D-047, spec 4.2). Pure: no network, no clock.
 * A mint is an operation that makes new units of a pinned asset; a burn removes units. Every
 * amount is parsed to stroops (BigInt). An operation the rules cannot size is `unclassified`
 * and reconciliation (reconcile.ts) decides whether the supply still adds up.
 */
import { toStroops } from "../chain/asset";
import { field, type HorizonEffect, type HorizonOp } from "./types";

export type SupplyOp = { asset: string; side: "mint" | "burn"; amount: bigint };

export type IssuerChange = { type: "issuer_options" | "issuer_merged"; changes: string[] };

export type OpResult = {
  supply: SupplyOp[];
  /** Asset keys (`CODE:ISSUER`) touched by an operation the rules cannot size. */
  unclassified: string[];
  issuerChange: IssuerChange | null;
};

const EMPTY: OpResult = { supply: [], unclassified: [], issuerChange: null };

const AMOUNT = /^\d+(?:\.\d{1,7})?$/;
/** Exact stroops, or null for anything that is not a plain non-negative decimal with at most 7 decimals. */
const parseAmount = (s: unknown): bigint | null => (typeof s === "string" && AMOUNT.test(s) ? toStroops(s) : null);

const OFFER_TYPES = new Set(["manage_sell_offer", "manage_buy_offer", "create_passive_sell_offer"]);
const POOL_TYPES = new Set(["liquidity_pool_deposit", "liquidity_pool_withdraw"]);
const CB_TYPES = new Set(["claim_claimable_balance", "clawback_claimable_balance"]);

/** True for the claimable-balance operations by the issuer whose amount lives only in the op's effects. */
export const needsEffects = (op: HorizonOp, issuer: string): boolean => CB_TYPES.has(op.type) && op.source_account === issuer && op.transaction_successful === true;

/** Printable ASCII only, so a hostile on-chain string cannot carry control characters into a log. */
const clean = (s: string, max = 100) => s.slice(0, max).replace(/[^\x20-\x7E]/g, "?");

/** What a successful `set_options` changed, from the fields Horizon shows (spec 4.2). */
export function optionsChanges(op: HorizonOp): string[] {
  const out: string[] = [];
  const list = (name: string) => (Array.isArray(op[name]) ? (op[name] as unknown[]).filter((x): x is string => typeof x === "string") : []);
  for (const f of list("set_flags_s")) out.push(`set flag ${clean(f, 40)}`);
  for (const f of list("clear_flags_s")) out.push(`clear flag ${clean(f, 40)}`);
  const num = (name: string) => (typeof op[name] === "number" && Number.isInteger(op[name]) ? (op[name] as number) : null);
  const master = num("master_key_weight");
  if (master !== null) out.push(`master key weight ${master}`);
  for (const [name, label] of [["low_threshold", "low"], ["med_threshold", "medium"], ["high_threshold", "high"]] as const) {
    const v = num(name);
    if (v !== null) out.push(`${label} threshold ${v}`);
  }
  const signer = field(op, "signer_key");
  const weight = num("signer_weight");
  if (signer !== undefined && weight !== null) out.push(weight === 0 ? `signer ${clean(signer, 56)} removed` : `signer ${clean(signer, 56)} weight ${weight}`);
  const domain = field(op, "home_domain");
  if (domain !== undefined) out.push(`home domain ${clean(domain)}`);
  return out;
}

/**
 * @param issuer the issuer account I of the pinned assets
 * @param pinnedCodes the codes pinned for I in data/assets.csv (case-sensitive: `gBENJI` is not `GBENJI`)
 * @param effects the op's effects, for `needsEffects` operations (undefined = not fetched)
 */
export function classifyOp(op: HorizonOp, issuer: string, pinnedCodes: readonly string[], effects?: readonly HorizonEffect[]): OpResult {
  if (op.transaction_successful !== true) return EMPTY;
  const codes = new Set(pinnedCodes);
  const key = (code: string) => `${code}:${issuer}`;
  const named = (code: unknown, iss: unknown): string | null => (typeof code === "string" && iss === issuer && codes.has(code) ? key(code) : null);
  /** "CODE:ISSUER" as Horizon writes a claimable balance or pool asset. */
  const namedString = (s: unknown): string | null => {
    if (typeof s !== "string") return null;
    const i = s.indexOf(":");
    return i > 0 ? named(s.slice(0, i), s.slice(i + 1)) : null;
  };
  const sized = (asset: string, side: "mint" | "burn", amount: unknown): OpResult => {
    const a = parseAmount(amount);
    return a === null ? { supply: [], unclassified: [asset], issuerChange: null } : { supply: [{ asset, side, amount: a }], unclassified: [], issuerChange: null };
  };
  const allAssets = [...codes].map(key);

  switch (op.type) {
    case "payment": {
      const asset = named(op.asset_code, op.asset_issuer);
      if (!asset) return EMPTY;
      if (op.from === issuer && op.to !== issuer) return sized(asset, "mint", op.amount);
      if (op.to === issuer && op.from !== issuer) return sized(asset, "burn", op.amount);
      return EMPTY;
    }
    case "path_payment_strict_send":
    case "path_payment_strict_receive": {
      const out: OpResult = { supply: [], unclassified: [], issuerChange: null };
      const src = named(op.source_asset_code, op.source_asset_issuer);
      const dst = named(op.asset_code, op.asset_issuer);
      const parts: OpResult[] = [];
      if (op.from === issuer && src) parts.push(sized(src, "mint", op.source_amount));
      if (op.to === issuer && dst) parts.push(sized(dst, "burn", op.amount));
      for (const p of parts) { out.supply.push(...p.supply); out.unclassified.push(...p.unclassified); }
      return out;
    }
    case "create_claimable_balance": {
      // A balance made by a holder moves units that already exist: no supply change.
      const asset = namedString(op.asset);
      return asset && op.source_account === issuer ? sized(asset, "mint", op.amount) : EMPTY;
    }
    case "claim_claimable_balance":
    case "clawback_claimable_balance": {
      if (op.source_account !== issuer) return EMPTY;
      // The op has no amount. The issuer being credited with a pinned asset is the burn.
      const credited = (effects ?? []).filter((e) => e.type === "account_credited" && e.account === issuer);
      if (credited.length === 0) return { supply: [], unclassified: allAssets, issuerChange: null };
      const out: OpResult = { supply: [], unclassified: [], issuerChange: null };
      for (const e of credited) {
        const asset = named(e.asset_code, e.asset_issuer);
        if (!asset) continue;
        const p = sized(asset, "burn", e.amount);
        out.supply.push(...p.supply);
        out.unclassified.push(...p.unclassified);
      }
      return out;
    }
    case "clawback": {
      const asset = named(op.asset_code, op.asset_issuer);
      return asset ? sized(asset, "burn", op.amount) : EMPTY;
    }
    case "invoke_host_function": {
      const changes = Array.isArray(op.asset_balance_changes) ? (op.asset_balance_changes as Record<string, unknown>[]) : [];
      const out: OpResult = { supply: [], unclassified: [], issuerChange: null };
      for (const c of changes) {
        const asset = named(c.asset_code, c.asset_issuer);
        if (!asset) continue;
        const t = c.type;
        let side: "mint" | "burn" | null = null;
        if (t === "mint") side = "mint";
        else if (t === "burn" || t === "clawback") side = "burn";
        else if (t === "transfer") side = c.from === issuer ? "mint" : c.to === issuer ? "burn" : null;
        if (!side) continue;
        const p = sized(asset, side, c.amount);
        out.supply.push(...p.supply);
        out.unclassified.push(...p.unclassified);
      }
      return out;
    }
    case "set_options":
      return op.source_account === issuer ? { supply: [], unclassified: [], issuerChange: { type: "issuer_options", changes: optionsChanges(op) } } : EMPTY;
    case "account_merge":
      return op.source_account === issuer ? { supply: [], unclassified: [], issuerChange: { type: "issuer_merged", changes: [] } } : EMPTY;
    default:
      break;
  }
  if (op.source_account === issuer && (OFFER_TYPES.has(op.type) || POOL_TYPES.has(op.type))) {
    const hit = new Set<string>();
    for (const [c, i] of [["selling_asset_code", "selling_asset_issuer"], ["buying_asset_code", "buying_asset_issuer"]] as const) {
      const a = named(op[c], op[i]);
      if (a) hit.add(a);
    }
    for (const name of ["reserves_max", "reserves_min", "reserves_deposited", "reserves_received"]) {
      const list = op[name];
      if (Array.isArray(list)) for (const r of list as Record<string, unknown>[]) { const a = namedString(r?.asset); if (a) hit.add(a); }
    }
    return { supply: [], unclassified: [...hit], issuerChange: null };
  }
  return EMPTY;
}
