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
