/**
 * Claim fields v1, chosen for the flags that use them (internal/product.md):
 * SUPPLY_MISMATCH, STALE_ATTESTATION, PRICE_DEVIATION, plus context for
 * fact sheets. The LLM output schema lives here too.
 */
import { z } from "zod";

export type ValueKind = "amount" | "date" | "text";

export const CLAIM_FIELDS = {
  net_assets: { kind: "amount", hint: "Net assets, assets under management, or value of underlying assets actually held now (all chains), with currency. Not an offering size, program limit, or nominal amount of an issuance." },
  units_outstanding: { kind: "amount", hint: "Number of fund shares or tokens actually issued and outstanding now. Not the number offered, authorized, or the maximum." },
  max_issuance: { kind: "amount", hint: "Maximum, authorized, or offered size of the issuance (total nominal amount or number of units)." },
  nav_per_unit: { kind: "amount", hint: "Current net asset value or market price per share or per token, with currency. Not the nominal (face) value." },
  token_unit_ratio: { kind: "amount", hint: "How many fund shares or underlying units one token represents (e.g. 1)." },
  stellar_supply: { kind: "amount", hint: "Amount of tokens stated as issued or outstanding on Stellar specifically." },
  report_date: { kind: "date", hint: "Date of an attestation, NAV report, audit, or financial statement the document refers to." },
  networks: { kind: "text", hint: "A blockchain network the token is issued on (one claim per network)." },
  custodian: { kind: "text", hint: "Custodian, trustee, or depositary of the underlying assets." },
  auditor: { kind: "text", hint: "Auditor or attestation provider." },
} as const satisfies Record<string, { kind: ValueKind; hint: string }>;

export type ClaimField = keyof typeof CLAIM_FIELDS;

/**
 * Deterministic field gate: the quote itself must read like the field, and
 * hedged or target wording is refused. The LLM's field label is a judgement;
 * this gate keeps the obvious mislabels out (e.g. "Current TVL" as net
 * assets, "seeks to maintain $1.00" as a NAV, a logo strip as networks).
 */
export const FIELD_GATES: Record<ClaimField, { require: RegExp; reject?: RegExp }> = {
  net_assets: {
    require: /net assets|assets under management|\bAUM\b|underlying assets|fund size|total assets|nettoinventar|fondsvermögen/i,
    reject: /\bTVL\b|\bseeks?\b|\bmay\b|\bup to\b|\btarget/i,
  },
  units_outstanding: {
    require: /outstanding|in circulation|\bissued\b|currently issued|ausgegeben|im umlauf/i,
    reject: /\bup to\b|\bmay\b|\boffer|angebot|maximum|authori[sz]ed|will be issued|werden .* ausgegeben/i,
  },
  max_issuance: {
    require: /offer|\bissue|nominal|maximum|\bup to\b|aggregate|authori[sz]ed|gesamtnennbetrag|angebot|begibt|ausgegeben|emission/i,
  },
  nav_per_unit: {
    require: /\bNAV\b|net asset value|\bprice\b|per (share|token|unit|certificate)|nettoinventarwert|ausgabepreis|\bpreis\b/i,
    reject: /\bseeks?\b|\bstable\b|\baims?\b|\btarget|\bmay\b|\balways\b/i,
  },
  token_unit_ratio: { require: /token/i },
  stellar_supply: { require: /stellar/i, reject: /\bup to\b|\bmay\b/i },
  report_date: { require: /as of|attest|audit|report|statement|dated|stichtag|\bstand\b|prüf/i },
  networks: {
    require: /network|blockchain|\bchains?\b|available on|issued on|deployed|\bbased on\b|\bvia\b|netzwerk/i,
    reject: /\bmay\b|\bcould\b|\bmight\b|potentially|\bplans?\b/i,
  },
  custodian: { require: /custod|trustee|depositary|verwahr|in custody/i },
  auditor: { require: /audit|attest|prüf/i },
};
export const FIELD_NAMES = Object.keys(CLAIM_FIELDS) as [ClaimField, ...ClaimField[]];

export const MAX_CLAIMS_PER_DOCUMENT = 25;

/**
 * What the LLM must return. Kept to types and enums only: Gemini rejects
 * JSON Schema keywords such as exclusiveMinimum. Lengths and counts are
 * enforced by code (verify.ts and the extraction script), not the schema.
 */
export function extractionSchema(assetCodes: [string, ...string[]]) {
  return z.object({
    claims: z.array(
      z.object({
        field: z.enum(FIELD_NAMES),
        asset_code: z.enum([...assetCodes, "ISSUER"] as [string, ...string[]]),
        value_text: z.string(),
        unit: z.string().nullable(),
        as_of_text: z.string().nullable(),
        quote: z.string(),
        page: z.number().int().nullable(),
      }),
    ),
  });
}

export type ProposedClaim = z.infer<ReturnType<typeof extractionSchema>>["claims"][number];
