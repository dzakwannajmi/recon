/**
 * Quote or discard (golden rule 2), in deterministic code.
 *
 * A proposed claim becomes a verified claim only if:
 * 1. its quote appears exactly once in the snapshot text (only whitespace,
 *    typographic quotes, dashes and PDF ligatures are normalized; case,
 *    digits and superscripts are not),
 * 2. `value_text` (and `as_of_text`, if any) appear inside the quote as a
 *    whole token, never inside a longer word or number, and an amount does
 *    not leave out a scale word that follows it,
 * 3. code can parse the value from the DOCUMENT's characters at that spot
 *    (the stored value_text is the document's span, not the LLM's copy),
 * 4. the quote reads like the field (FIELD_GATES),
 * 5. the claim is attributed to the asset mentioned closest before the quote,
 *    unless the document is dedicated to a single asset.
 * The page and the unit are computed by code, never taken from the LLM.
 */
import { PAGE_BREAK } from "../documents/extract";
import { CLAIM_FIELDS, FIELD_GATES, type ClaimField, type ProposedClaim } from "./fields";
import { followsScale, parseAmount, parseDate, type Locale } from "./parse";

export const MIN_QUOTE_CHARS = 20;
export const MAX_QUOTE_CHARS = 600;
export const MAX_VALUE_CHARS = 120;
/** How far before a quote an asset code or name may appear to attribute it. */
export const ATTRIBUTION_WINDOW = 400;
const SUPPLY_FIELDS = new Set<ClaimField>(["stellar_supply", "units_outstanding"]);
const TABLE_SCALE = /\bin (thousands|millions|billions)\b|\((?:\$|USD|EUR)?\s*000s?\)|\bin tausend\b|\bin (mio|mrd)\b|in tsd/i;

export type DropReason =
  | "quote_too_short"
  | "quote_too_long"
  | "quote_not_found"
  | "quote_ambiguous"
  | "value_not_in_quote"
  | "value_scale_omitted"
  | "value_unparseable"
  | "as_of_not_in_quote"
  | "as_of_unparseable"
  | "field_gate"
  | "attribution_unverified"
  | "issuer_ambiguous"
  | "over_cap";

const LIGATURES: Record<string, string> = { "ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi", "ﬄ": "ffl" };

/** Map each character to a comparable form; returns the normalized string and, per char, its source index. */
export function normalizeForMatch(text: string): { value: string; map: number[] } {
  const out: string[] = [];
  const map: number[] = [];
  let lastSpace = true;
  for (let i = 0; i < text.length; i++) {
    const raw = text[i];
    if (/[\s ​ ]/.test(raw)) {
      if (!lastSpace) {
        out.push(" ");
        map.push(i);
      }
      lastSpace = true;
      continue;
    }
    const ch = (LIGATURES[raw] ?? raw)
      .replace(/[‘’‚′]/g, "'")
      .replace(/[“”„″]/g, '"')
      .replace(/[‐-―−]/g, "-");
    for (const c of ch) {
      out.push(c);
      map.push(i);
    }
    lastSpace = false;
  }
  if (out.at(-1) === " ") {
    out.pop();
    map.pop();
  }
  return { value: out.join(""), map };
}

const norm = (s: string) => normalizeForMatch(s).value;

/** All normalized offsets where the quote occurs. */
export function findQuoteOffsets(document: { value: string }, quote: string) {
  const q = norm(quote);
  const found: number[] = [];
  if (!q) return found;
  for (let at = document.value.indexOf(q); at !== -1; at = document.value.indexOf(q, at + 1)) found.push(at);
  return found;
}

const isWordChar = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);
const isDigit = (c: string | undefined) => c !== undefined && /\d/.test(c);
/** Characters that join digit groups: "1,234", "1.234", "1 234", "1'234". */
const isDigitSeparator = (c: string | undefined) => c === "." || c === "," || c === " " || c === "'";

/** First index of `needle` in `hay` as a whole token: no letter or digit, and no digit separator, on either side. */
export function findToken(hay: string, needle: string) {
  if (!needle) return -1;
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + 1)) {
    const end = i + needle.length;
    const startsWord = isWordChar(needle[0]);
    const endsWord = isWordChar(needle.at(-1));
    const before = hay[i - 1];
    const after = hay[end];
    if (startsWord && isWordChar(before)) continue;
    if (endsWord && isWordChar(after)) continue;
    if (isDigit(needle[0]) && isDigitSeparator(before) && isDigit(hay[i - 2])) continue;
    if (isDigit(needle.at(-1)) && isDigitSeparator(after) && isDigit(hay[end + 1])) continue;
    // A decimal mark split from its digits by a space ("5. 75") still joins one number.
    if (isDigit(needle[0]) && before === " " && (hay[i - 2] === "." || hay[i - 2] === ",") && isDigit(hay[i - 3])) continue;
    if (isDigit(needle.at(-1)) && (after === "." || after === ",") && hay[end + 1] === " " && isDigit(hay[end + 2])) continue;
    return i;
  }
  return -1;
}

/** 1-based page of an offset in PDF text (pages separated by \f); null for other kinds. */
export function pageAt(text: string, offset: number, isPdf: boolean) {
  if (!isPdf) return null;
  let page = 1;
  for (let i = text.indexOf(PAGE_BREAK); i !== -1 && i < offset; i = text.indexOf(PAGE_BREAK, i + 1)) page++;
  return page;
}

const CURRENCY_SYMBOL: Record<string, string> = { $: "USD", "€": "EUR", "£": "GBP" };
const CURRENCY_CODE = /\b(USD|EUR|GBP|CHF|JPY|MXN|BRL|KRW|SGD|HKD|CAD|AUD)\b/;

/**
 * The currency of an amount, read from the document at the value: an ISO
 * code inside the span, directly before the number, or directly after the
 * value (and its scale word); else a symbol right before the number ($ is
 * USD only when no letters are glued to it, so A$, C$ and HK$ give null).
 */
export function currencyAround(text: string, start: number, end: number): string | null {
  const span = text.slice(start, end);
  const inSpan = CURRENCY_CODE.exec(span);
  if (inSpan) return inSpan[1];
  const firstDigit = span.search(/\d/);
  const numberStart = firstDigit === -1 ? start : start + firstDigit;
  const before = /\b(USD|EUR|GBP|CHF|JPY|MXN|BRL|KRW|SGD|HKD|CAD|AUD)\s*$/.exec(text.slice(Math.max(0, numberStart - 6), numberStart));
  if (before) return before[1];
  // Only a scale word may sit between the value and a following code ("5 million USD").
  const after = /^\s*(?:(?:trillions?|billions?|millions?|thousands?|mio\.?|mrd\.?|bn|mn|tn|[BMKT])\s+)?(USD|EUR|GBP|CHF|JPY|MXN|BRL|KRW|SGD|HKD|CAD|AUD)\b/i.exec(text.slice(end, end + 24));
  if (after) return after[1].toUpperCase();
  const symbol = /([A-Za-z]*)([$€£])\s*$/.exec(text.slice(Math.max(0, numberStart - 6), numberStart));
  if (!symbol || symbol[1]) return null;
  return CURRENCY_SYMBOL[symbol[2]];
}

export type AssetRef = { code: string; name?: string };

export type VerifyContext = {
  text: string;
  normalized: { value: string; map: number[] };
  isPdf: boolean;
  locale: Locale;
  assets: AssetRef[];
  /** The document is about one asset only (its prospectus or pinned page). */
  dedicated: boolean;
  /** Other tickers an amount could belong to (universe codes, XLM, ...): a quote naming one of them is not about the claimed asset. */
  knownCodes?: string[];
};

const TICKER_STOPWORDS = new Set(["USD", "EUR", "GBP", "CHF", "NAV", "APY", "TVL", "AUM", "SEC", "LLC", "INC", "FDIC", "ETF", "ISIN", "USA", "EDT", "EST", "UTC", "PDF", "KYC", "AML"]);

/** Tickers named in a quote: known codes as whole words, and any "(ABC)" in parentheses. */
function tickersIn(quote: string, knownCodes: string[]) {
  const found = new Set<string>();
  for (const code of knownCodes) if (new RegExp(`(?<![A-Za-z0-9])${code}(?![A-Za-z0-9])`).test(quote)) found.add(code);
  for (const m of quote.matchAll(/\(([A-Z]{2,6})\)/g)) if (!TICKER_STOPWORDS.has(m[1])) found.add(m[1]);
  return found;
}

export type VerifiedValue = {
  value: number | string;
  value_text: string;
  unit: string | null;
  as_of: string | null;
  page: number | null;
};

/** Find a token inside the matched quote and return its span in the source text. */
function spanInQuote(ctx: VerifyContext, quoteAt: number, quoteLength: number, token: string) {
  const quoteNorm = ctx.normalized.value.slice(quoteAt, quoteAt + quoteLength);
  const t = norm(token);
  const i = findToken(quoteNorm, t);
  if (i === -1) return null;
  const start = ctx.normalized.map[quoteAt + i];
  const end = ctx.normalized.map[quoteAt + i + t.length - 1] + 1;
  return { start, end };
}

function mentionIndex(context: string, asset: AssetRef) {
  const code = asset.code.replace(/[^A-Za-z0-9]/g, "");
  const codeRe = new RegExp(`(?<![A-Za-z0-9])${code}(?![A-Za-z0-9])`, "g");
  let last = -1;
  for (const m of context.matchAll(codeRe)) last = m.index!;
  if (asset.name) {
    const normalized = normalizeForMatch(context);
    const at = normalized.value.lastIndexOf(norm(asset.name));
    if (at !== -1) last = Math.max(last, normalized.map[at]);
  }
  return last;
}

export function verifyClaim(claim: ProposedClaim, ctx: VerifyContext): { ok: true; result: VerifiedValue } | { ok: false; reason: DropReason } {
  const quoteNorm = norm(claim.quote);
  if (quoteNorm.length < MIN_QUOTE_CHARS) return { ok: false, reason: "quote_too_short" };
  if (claim.quote.length > MAX_QUOTE_CHARS || claim.value_text.length > MAX_VALUE_CHARS) return { ok: false, reason: "quote_too_long" };

  const offsets = findQuoteOffsets(ctx.normalized, claim.quote);
  if (offsets.length === 0) return { ok: false, reason: "quote_not_found" };
  if (offsets.length > 1) return { ok: false, reason: "quote_ambiguous" };
  const quoteAt = offsets[0];
  const quoteStart = ctx.normalized.map[quoteAt];
  const quoteEnd = ctx.normalized.map[quoteAt + quoteNorm.length - 1] + 1;

  const field = claim.field as ClaimField;
  const kind = CLAIM_FIELDS[field].kind;
  const valueSpan = spanInQuote(ctx, quoteAt, quoteNorm.length, claim.value_text);
  if (!valueSpan) return { ok: false, reason: "value_not_in_quote" };
  const valueText = ctx.text.slice(valueSpan.start, valueSpan.end);
  if (kind === "amount" && followsScale(ctx.text.slice(valueSpan.end, valueSpan.end + 14))) {
    return { ok: false, reason: "value_scale_omitted" };
  }
  // Amounts under a "(in thousands)" style header are scaled by a factor the quote doesn't show.
  if (kind === "amount" && TABLE_SCALE.test(ctx.text.slice(Math.max(0, quoteStart - 300), quoteEnd))) {
    return { ok: false, reason: "value_scale_omitted" };
  }
  const value = kind === "amount" ? parseAmount(valueText, ctx.locale) : kind === "date" ? parseDate(valueText) : valueText.replace(/\s+/g, " ").trim();
  if (value === null || value === "") return { ok: false, reason: "value_unparseable" };

  let asOf: string | null = null;
  if (claim.as_of_text) {
    const asOfSpan = spanInQuote(ctx, quoteAt, quoteNorm.length, claim.as_of_text);
    if (!asOfSpan) return { ok: false, reason: "as_of_not_in_quote" };
    asOf = parseDate(ctx.text.slice(asOfSpan.start, asOfSpan.end));
    if (!asOf) return { ok: false, reason: "as_of_unparseable" };
  }

  const quoteText = ctx.text.slice(quoteStart, quoteEnd);
  const gate = FIELD_GATES[field];
  if (!gate.require.test(quoteText) || gate.reject?.test(quoteText)) return { ok: false, reason: "field_gate" };

  if (kind === "amount" && claim.asset_code !== "ISSUER") {
    // An amount whose quote names another asset is about that asset.
    const named = tickersIn(quoteText, [...(ctx.knownCodes ?? []), ...ctx.assets.map((a) => a.code)]);
    named.delete(claim.asset_code);
    if (named.size > 0) return { ok: false, reason: "attribution_unverified" };
    // Outside a dedicated document, an amount must name its asset in the quote itself; supply
    // counts always must, since a prospectus also describes other tokens (e.g. XLM in lumens).
    const claimed = ctx.assets.find((a) => a.code === claim.asset_code);
    const mustName = !ctx.dedicated || SUPPLY_FIELDS.has(field);
    if (mustName && !(claimed && mentionIndex(quoteText, claimed) !== -1)) return { ok: false, reason: "attribution_unverified" };
  }

  if (claim.asset_code !== "ISSUER" && !(ctx.dedicated && ctx.assets.length === 1 && ctx.assets[0].code === claim.asset_code)) {
    // Only text before and inside the quote counts; the closest mention wins.
    const context = ctx.text.slice(Math.max(0, quoteStart - ATTRIBUTION_WINDOW), quoteEnd);
    const claimed = ctx.assets.find((a) => a.code === claim.asset_code);
    if (!claimed) return { ok: false, reason: "attribution_unverified" };
    const mine = mentionIndex(context, claimed);
    const closestOther = Math.max(-1, ...ctx.assets.filter((a) => a !== claimed).map((a) => mentionIndex(context, a)));
    if (mine === -1 || closestOther > mine) return { ok: false, reason: "attribution_unverified" };
  }

  return {
    ok: true,
    result: {
      value,
      value_text: valueText,
      unit: kind === "amount" ? currencyAround(ctx.text, valueSpan.start, valueSpan.end) : null,
      as_of: asOf,
      page: pageAt(ctx.text, quoteStart, ctx.isPdf),
    },
  };
}
