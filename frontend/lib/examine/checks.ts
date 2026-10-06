/**
 * Examiner checks v1: compare on-chain supply with what documents state.
 * Pure functions; amounts compared exactly in stroops where the document
 * states an exact number. Statements follow golden rule 4:
 * "Mismatch between {document} ({where}) and on-chain {value} as of {date}."
 * A check never says why a mismatch exists; that is the investigation's job.
 */
import { formatStroops, toStroops } from "../chain/asset";

export type CheckName = "supply_vs_toml_fixed_number" | "supply_vs_toml_max_number" | "supply_vs_filed_shares" | "supply_vs_max_issuance";

export type Reference = {
  kind: "filing" | "toml" | "claim";
  label: string; // e.g. "SEC N-MFP3 filed 2026-09-04", "stellar.toml"
  value: number;
  unit: string | null;
  as_of: string | null;
  source_url: string;
  quote: string;
  where: string | null; // page or section
  snapshot_sha256: string;
};

export type CheckResult = {
  asset: string;
  check: CheckName;
  status: "consistent" | "mismatch" | "not_comparable";
  onchain: { supply: string; as_of: string };
  reference: Reference | null;
  /** The token ratio used to convert, when one was used. */
  ratio: Reference | null;
  /** The reference expressed in tokens (decimal string), for investigations. */
  threshold_tokens: string | null;
  /** On-chain minus reference, in tokens, when comparable. */
  difference: string | null;
  statement: string;
};

/** Tolerance for comparing today's supply with a month-end or quarter-end filing (fund flows). */
export const FILED_SHARES_TOLERANCE = 0.1;
/** An excess over a filing older than this (days) is not compared: normal flows can explain it. */
export const MAX_FILING_AGE_DAYS = 35;

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 7 });
const decimal = (n: number) => n.toFixed(7);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / 86_400_000);
const where = (r: Reference) => `${r.label}${r.where ? `, ${r.where}` : ""}`;
const day = (iso: string) => iso.slice(0, 10);

function result(
  asset: string, check: CheckName, onchain: CheckResult["onchain"], reference: Reference | null, status: CheckResult["status"],
  difference: string | null, statement: string, extra: { ratio?: Reference | null; threshold?: string | null } = {},
): CheckResult {
  return { asset, check, status, onchain, reference, ratio: extra.ratio ?? null, threshold_tokens: extra.threshold ?? null, difference, statement };
}

/** SEP-1 fixed_number: the number of tokens will never change, so supply must equal it exactly. */
export function checkTomlFixedNumber(asset: string, supply: string, asOf: string, ref: Reference): CheckResult {
  const onchain = { supply, as_of: asOf };
  const diff = toStroops(supply) - BigInt(ref.value) * 10_000_000n;
  const threshold = String(ref.value);
  if (diff === 0n) return result(asset, "supply_vs_toml_fixed_number", onchain, ref, "consistent", "0.0000000", `On-chain supply ${supply} equals the fixed_number in ${where(ref)} (${fmt(ref.value)}) as of ${day(asOf)}.`, { threshold });
  const signed = (diff < 0n ? "-" : "") + formatStroops(diff < 0n ? -diff : diff);
  return result(
    asset, "supply_vs_toml_fixed_number", onchain, ref, "mismatch", signed,
    `Mismatch between ${ref.label} (${ref.where ? `${ref.where}, ` : ""}fixed_number ${fmt(ref.value)}) and on-chain supply ${supply} as of ${day(asOf)}.`,
    { threshold },
  );
}

/** SEP-1 max_number: supply may never exceed it. */
export function checkTomlMaxNumber(asset: string, supply: string, asOf: string, ref: Reference): CheckResult {
  const onchain = { supply, as_of: asOf };
  const diff = toStroops(supply) - BigInt(ref.value) * 10_000_000n;
  const threshold = String(ref.value);
  if (diff <= 0n) return result(asset, "supply_vs_toml_max_number", onchain, ref, "consistent", null, `On-chain supply ${supply} is within the max_number in ${where(ref)} (${fmt(ref.value)}) as of ${day(asOf)}.`, { threshold });
  return result(
    asset, "supply_vs_toml_max_number", onchain, ref, "mismatch", formatStroops(diff),
    `Mismatch between ${ref.label} (${ref.where ? `${ref.where}, ` : ""}max_number ${fmt(ref.value)}) and on-chain supply ${supply} as of ${day(asOf)}.`,
    { threshold },
  );
}

/**
 * Stellar supply against the share class's shares outstanding in an SEC
 * filing. Tokens on Stellar can be a part of the class (other chains,
 * off-chain holders), never more than it beyond a tolerance for flows since
 * the report date. Only a stated 1:1 token-to-share ratio is used for now:
 * any other ratio's direction is an LLM reading that code can't confirm.
 */
export function checkFiledShares(asset: string, supply: string, asOf: string, filed: Reference, ratios: Reference[]): CheckResult {
  const onchain = { supply, as_of: asOf };
  const usable = ratios.filter((r) => r.value === 1 && (r.unit === null || /^shares?$/i.test(r.unit)));
  if (usable.length === 0 || usable.length !== ratios.length) {
    const why = ratios.length === 0 ? "the issuer states no token-to-share ratio" : "the stated token ratios are not a single 1:1 token-to-share ratio";
    return result(asset, "supply_vs_filed_shares", onchain, filed, "not_comparable", null, `Not comparable: ${why}, so ${supply} tokens can't be compared with ${fmt(filed.value)} shares in ${where(filed)}.`);
  }
  const ratio = usable[0];
  const units = Number(supply);
  const share = (units / filed.value) * 100;
  const difference = decimal(units - filed.value);
  const extra = { ratio, threshold: decimal(filed.value) };
  if (units <= filed.value * (1 + FILED_SHARES_TOLERANCE)) {
    return result(
      asset, "supply_vs_filed_shares", onchain, filed, "consistent", difference,
      `On-chain supply ${supply} (1 share per token) is ${share.toFixed(2)}% of the ${fmt(filed.value)} shares in ${where(filed)} (as of ${filed.as_of}); on-chain as of ${day(asOf)}.`,
      extra,
    );
  }
  const age = filed.as_of ? daysBetween(filed.as_of, asOf) : Infinity;
  if (age > MAX_FILING_AGE_DAYS) {
    return result(
      asset, "supply_vs_filed_shares", onchain, filed, "not_comparable", difference,
      `Not comparable: on-chain supply ${supply} is above the ${fmt(filed.value)} shares in ${where(filed)}, but that report is ${age} days older than the on-chain data (as of ${day(asOf)}), so flows since then can explain it.`,
      extra,
    );
  }
  return result(
    asset, "supply_vs_filed_shares", onchain, filed, "mismatch", difference,
    `Mismatch between ${where(filed)} (${fmt(filed.value)} shares as of ${filed.as_of}) and on-chain supply ${supply} as of ${day(asOf)}.`,
    extra,
  );
}

/**
 * Supply against the stated maximum issuance. A currency amount is turned
 * into tokens only with a token ratio stated in the same currency.
 */
export function checkMaxIssuance(asset: string, supply: string, asOf: string, max: Reference, ratio: Reference | null): CheckResult {
  const onchain = { supply, as_of: asOf };
  let maxTokens: number | null = null;
  if (max.unit && ratio?.unit && max.unit === ratio.unit && ratio.value > 0) maxTokens = max.value / ratio.value;
  if (maxTokens === null) {
    return result(asset, "supply_vs_max_issuance", onchain, max, "not_comparable", null, `Not comparable: ${where(max)} states ${fmt(max.value)}${max.unit ? ` ${max.unit}` : ""} with no token ratio in the same unit.`);
  }
  const over = decimal(Number(supply) - maxTokens);
  const extra = { ratio, threshold: decimal(maxTokens) };
  if (Number(over) <= 0) {
    return result(asset, "supply_vs_max_issuance", onchain, max, "consistent", over, `On-chain supply ${supply} is within the maximum issuance of ${fmt(maxTokens)} tokens (${where(max)}) as of ${day(asOf)}.`, extra);
  }
  return result(
    asset, "supply_vs_max_issuance", onchain, max, "mismatch", over,
    `Mismatch between ${where(max)} (maximum ${fmt(maxTokens)} tokens) and on-chain supply ${supply} as of ${day(asOf)}.`,
    extra,
  );
}
