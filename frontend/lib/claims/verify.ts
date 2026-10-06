/**
 * Quote or discard (golden rule 2), in deterministic code.
 *
 * A proposed claim becomes a verified claim only if:
 * 1. the snapshot text is the one the extractor produced (text hash + version),
 * 2. its quote appears verbatim in that text (only whitespace, typographic
 *    quotes, dashes and Unicode compatibility forms are normalized),
 * 3. `value_text` (and `as_of_text`, if any) appear inside the quote,
 * 4. code can parse the value (amount or date) from `value_text`,
 * 5. for documents about several assets, the asset code or name appears in
 *    the quote or just before it.
 * The page is computed from the match position, never taken from the LLM.
 */
import { PAGE_BREAK } from "../documents/extract";
import { CLAIM_FIELDS, type ClaimField, type ProposedClaim } from "./fields";
import { parseAmount, parseDate } from "./parse";

export const MIN_QUOTE_CHARS = 12;
export const MAX_QUOTE_CHARS = 600;
export const MAX_VALUE_CHARS = 120;
/** How far before a quote an asset code or name may appear to attribute it (multi-asset documents). */
export const ATTRIBUTION_WINDOW = 400;

export type DropReason =
  | "quote_too_short"
  | "quote_too_long"
  | "quote_not_found"
  | "value_not_in_quote"
  | "value_unparseable"
  | "as_of_not_in_quote"
  | "as_of_unparseable"
  | "attribution_unverified";

/** Map each character to a comparable form; returns the normalized string and, per char, its source index. */
export function normalizeForMatch(text: string): { value: string; map: number[] } {
  const out: string[] = [];
  const map: number[] = [];
  let lastSpace = true;
  for (let i = 0; i < text.length; i++) {
    let ch = text[i].normalize("NFKC");
    if (/[\s ​]/.test(ch)) {
      if (!lastSpace) {
        out.push(" ");
        map.push(i);
      }
      lastSpace = true;
      continue;
    }
    ch = ch.replace(/[‘’‚′]/g, "'").replace(/[“”„″]/g, '"').replace(/[‐-―−]/g, "-");
    for (const c of ch.toLowerCase()) {
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

/** Find a quote in the document text; returns the source offset of the first match or null. */
export function findQuote(document: { value: string; map: number[] }, quote: string): number | null {
  const q = norm(quote);
  if (!q) return null;
  const at = document.value.indexOf(q);
  return at === -1 ? null : document.map[at];
}

/** 1-based page of an offset in PDF text (pages separated by \f); null for other kinds. */
export function pageAt(text: string, offset: number, isPdf: boolean) {
  if (!isPdf) return null;
  let page = 1;
  for (let i = text.indexOf(PAGE_BREAK); i !== -1 && i < offset; i = text.indexOf(PAGE_BREAK, i + 1)) page++;
  return page;
}

export type AssetRef = { code: string; name?: string };

export type VerifiedValue = { value: number | string; as_of: string | null; page: number | null };

export function verifyClaim(input: {
  claim: ProposedClaim;
  text: string;
  normalized: { value: string; map: number[] };
  isPdf: boolean;
  assets: AssetRef[];
}): { ok: true; result: VerifiedValue } | { ok: false; reason: DropReason } {
  const { claim, text, normalized, isPdf, assets } = input;
  if (norm(claim.quote).length < MIN_QUOTE_CHARS) return { ok: false, reason: "quote_too_short" };
  if (claim.quote.length > MAX_QUOTE_CHARS || claim.value_text.length > MAX_VALUE_CHARS) return { ok: false, reason: "quote_too_long" };
  const offset = findQuote(normalized, claim.quote);
  if (offset === null) return { ok: false, reason: "quote_not_found" };

  const quote = norm(claim.quote);
  if (!quote.includes(norm(claim.value_text))) return { ok: false, reason: "value_not_in_quote" };

  const kind = CLAIM_FIELDS[claim.field as ClaimField].kind;
  const value = kind === "amount" ? parseAmount(claim.value_text) : kind === "date" ? parseDate(claim.value_text) : claim.value_text.trim();
  if (value === null || value === "") return { ok: false, reason: "value_unparseable" };

  let asOf: string | null = null;
  if (claim.as_of_text) {
    if (!quote.includes(norm(claim.as_of_text))) return { ok: false, reason: "as_of_not_in_quote" };
    asOf = parseDate(claim.as_of_text);
    if (!asOf) return { ok: false, reason: "as_of_unparseable" };
  }

  if (assets.length > 1 && claim.asset_code !== "ISSUER") {
    const asset = assets.find((a) => a.code === claim.asset_code);
    const start = Math.max(0, offset - ATTRIBUTION_WINDOW);
    const context = text.slice(start, offset + claim.quote.length + 50);
    const codeRe = asset && new RegExp(`(^|[^A-Za-z0-9])${asset.code.replace(/[^A-Za-z0-9]/g, "")}([^A-Za-z0-9]|$)`);
    const named = asset?.name && norm(context).includes(norm(asset.name));
    if (!asset || !(codeRe!.test(context) || named)) return { ok: false, reason: "attribution_unverified" };
  }

  return { ok: true, result: { value, as_of: asOf, page: pageAt(text, offset, isPdf) } };
}
