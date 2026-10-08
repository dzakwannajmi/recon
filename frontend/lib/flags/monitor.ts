import { toStroops } from "../chain/asset";
import { clear, notEvaluated, raised, type Evaluation } from "./types";

/** A single day above this share of supply is flagged (D-035). */
export const LARGE_MINT_BURN_SHARE = 0.2;
/** Market price this far from NAV per unit is flagged (D-035). */
export const PRICE_DEVIATION_SHARE = 0.02;

export type MintBurnInput = {
  supply: string;
  days: { date: string; minted: string; burned: string; supply_end: string }[];
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
 * LARGE_MINT_BURN (WARNING only). Needs daily issuance data from the Monitor
 * (W4.1); the status script passes null until then. A day is large when minted
 * or burned is more than 20% of max(supply at start, supply at end).
 */
export function flagLargeMintBurn(input: MintBurnInput | null): Evaluation {
  if (!input) return notEvaluated("LARGE_MINT_BURN", "Needs daily issuance data from the Monitor (W4.1)");
  if (input.days.length === 0) return notEvaluated("LARGE_MINT_BURN", "No daily issuance data in the input");
  type Hit = { date: string; side: "mint" | "burn"; amount: bigint; base: bigint; share: number };
  let largest: Hit | null = null;
  for (const d of input.days) {
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
  const asOf = input.days.map((d) => d.date).sort().at(-1)!;
  if (!largest) return clear("LARGE_MINT_BURN", `No single day minted or burned more than ${LARGE_MINT_BURN_SHARE * 100}% of supply in the input.`, asOf, []);
  return raised(
    "LARGE_MINT_BURN", "WARNING",
    `Single-day ${largest.side} of ${fmt(largest.amount)} on ${largest.date} is ${largest.share}% of supply (${fmt(largest.base)}); no matching document is checked in v1.`,
    largest.date, [],
  );
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
