import { toStroops } from "../chain/asset";
import { CHANGE_HOLD_DAYS, addDays, wholeDays } from "./changes";
import { clear, notEvaluated, raised, type Evaluation } from "./types";

/** A single day above this share of supply is flagged (D-035). */
export const LARGE_MINT_BURN_SHARE = 0.2;
/** Market price this far from NAV per unit is flagged (D-035). */
export const PRICE_DEVIATION_SHARE = 0.02;
/** A large day stays raised this many days after it (the D-038 hold, in check time). */
export const MINT_BURN_HOLD_DAYS = CHANGE_HOLD_DAYS;

/** One asset's daily issuance from the Monitor (`data/monitor/issuance/YYYY-MM-DD.json`). */
export type MintBurnInput = {
  supply: string;
  /** Complete days, proven by reconciliation against ledger-pinned supply. */
  days: { date: string; minted: string; burned: string; supply_end: string }[];
  /** Dates the Monitor could not prove (not covered, or not reconciled). */
  missing?: string[];
  /** Evidence reference of the asset's entry, e.g. `data/monitor/issuance/2026-10-17.json#BENJI:G…`. */
  ref?: string;
};

export type PriceInput = {
  market_price: number;
  market_source: string;
  market_as_of: string;
  nav_per_unit: number;
  nav_source: string;
  nav_as_of: string;
  currency_match: boolean;
};

const fmt = (stroops: bigint) => {
  const whole = stroops / 10_000_000n;
  const frac = (stroops % 10_000_000n).toString().padStart(7, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
};

/**
 * LARGE_MINT_BURN (WARNING only, flags-v4, D-047). A day is large when minted or burned is more than
 * 20% of max(supply at start, supply at end). The window is the 7 days before the day of the current
 * chain check, so the hold runs in check time like FLAG_CHANGE: a status run without new checks never
 * clears it. A day the Monitor could not prove is never read as quiet.
 */
export function flagLargeMintBurn(input: MintBurnInput | null, currentDay: string | null): Evaluation {
  if (!input) return notEvaluated("LARGE_MINT_BURN", "No daily issuance data from the Monitor for this asset.");
  if (!currentDay) return notEvaluated("LARGE_MINT_BURN", "No current chain check to anchor the 7-day window.");
  const window = Array.from({ length: MINT_BURN_HOLD_DAYS }, (_, i) => addDays(currentDay, i - MINT_BURN_HOLD_DAYS));
  const inWindow = (date: string) => { const n = wholeDays(date, currentDay); return n >= 1 && n <= MINT_BURN_HOLD_DAYS; };
  const unproven = new Set(input.missing ?? []);

  type Hit = { date: string; side: "mint" | "burn"; amount: bigint; base: bigint; share: number };
  let largest: Hit | null = null;
  for (const d of input.days) {
    if (!inWindow(d.date) || unproven.has(d.date)) continue;
    const [minted, burned, end] = [toStroops(d.minted), toStroops(d.burned), toStroops(d.supply_end)];
    const start = end - minted + burned;
    const base = start > end ? start : end;
    if (base <= 0n) continue;
    for (const [side, amount] of [["mint", minted], ["burn", burned]] as const) {
      // amount / base > 0.2, exactly: amount * 5 > base
      if (amount * 5n > base) {
        const share = Number((amount * 10_000n) / base) / 100;
        if (!largest || share > largest.share) largest = { date: d.date, side, amount, base, share };
      }
    }
  }
  const evidence = (suffix = "") => (input.ref ? [{ kind: "chain_check" as const, ref: `${input.ref}${suffix}` }] : []);
  if (largest) {
    return raised(
      "LARGE_MINT_BURN", "WARNING",
      `Single-day ${largest.side} of ${fmt(largest.amount)} on ${largest.date} is ${largest.share}% of supply (${fmt(largest.base)}); no matching document is checked in v1. Held through ${addDays(largest.date, MINT_BURN_HOLD_DAYS)}.`,
      currentDay, evidence(`#${largest.date}`),
    );
  }
  const have = new Set(input.days.map((d) => d.date));
  const gaps = window.filter((d) => !have.has(d) || unproven.has(d));
  if (gaps.length > 0) {
    return notEvaluated("LARGE_MINT_BURN", `Daily issuance data is missing or does not reconcile with on-chain supply for ${gaps.join(", ")}.`);
  }
  return clear("LARGE_MINT_BURN", `No single day from ${window[0]} to ${window[window.length - 1]} minted or burned more than ${LARGE_MINT_BURN_SHARE * 100}% of supply.`, currentDay, evidence());
}

/** PRICE_DEVIATION (WARNING only). Needs a market price and a NAV per unit in the same currency; null until sources exist. */
export function flagPriceDeviation(input: PriceInput | null): Evaluation {
  if (!input) return notEvaluated("PRICE_DEVIATION", "No market price source yet (Reflector/SDEX planned) and no NAV per unit in verified claims or filings");
  if (!input.currency_match) return notEvaluated("PRICE_DEVIATION", "The market price and the NAV per unit are not in the same currency");
  if (!(input.nav_per_unit > 0)) return notEvaluated("PRICE_DEVIATION", "The NAV per unit is not a positive number");
  // Rounded so that exactly 2% is not tipped over by floating point error.
  const deviation = Math.round((Math.abs(input.market_price - input.nav_per_unit) / input.nav_per_unit) * 1e10) / 1e10;
  if (deviation > PRICE_DEVIATION_SHARE) {
    return raised(
      "PRICE_DEVIATION", "WARNING",
      `Market price ${input.market_price} (${input.market_source}, ${input.market_as_of}) differs from NAV per unit ${input.nav_per_unit} (${input.nav_source}, ${input.nav_as_of}) by ${(deviation * 100).toFixed(2)}%.`,
      input.market_as_of, [],
    );
  }
  return clear("PRICE_DEVIATION", `Market price ${input.market_price} is within ${PRICE_DEVIATION_SHARE * 100}% of NAV per unit ${input.nav_per_unit}.`, input.market_as_of, []);
}
