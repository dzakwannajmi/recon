/**
 * Input and output schemas of the three tools (spec 4). Inputs are strict, so unknown keys are refused and
 * `tools/list` shows `additionalProperties: false`. Outputs are strict too and match the success bodies exactly.
 */
import { StrKey } from "@stellar/stellar-sdk";
import { z } from "zod";
import { FLAG_ORDER, type FlagName } from "../flags/types";
import { ASSET_CODE_PATTERN, ISSUER_PATTERN } from "../gateway/resolve";
import { FIELD_COPY } from "./copy";

export const FACT_SHEET_SCHEMA = "fact-sheet/1";
export const FLAG_LIST_SCHEMA = "flag-list/1";

// ---------------------------------------------------------------- inputs

export const assetInputSchema = z.strictObject({
  asset_code: z.string().regex(ASSET_CODE_PATTERN).describe(FIELD_COPY.asset_code),
  issuer: z.string().regex(ISSUER_PATTERN).refine((s) => StrKey.isValidEd25519PublicKey(s)).optional().describe(FIELD_COPY.issuer),
});

const flagNames = FLAG_ORDER as [FlagName, ...FlagName[]];

export const listFlagsInputSchema = z.strictObject({
  flag: z.enum(flagNames).optional().describe(FIELD_COPY.flag),
  severity: z.enum(["WARNING", "CRITICAL"]).optional().describe(FIELD_COPY.severity),
});

// ---------------------------------------------------------------- shared pieces

const nullableString = z.string().nullable();
const statusValue = z.enum(["OK", "WARNING", "CRITICAL"]).nullable();
const counts = z.strictObject({ raised: z.number().int(), clear: z.number().int(), not_evaluated: z.number().int() });
const assetBlock = z.strictObject({
  code: z.string(),
  issuer: z.string(),
  issuer_org: z.string(),
  type: z.string(),
  official_domain: nullableString,
  sac_contract_id: nullableString,
});

// ---------------------------------------------------------------- check_asset: check-summary/1

export const checkSummaryOutputSchema = z.strictObject({
  schema: z.literal("check-summary/1"),
  asset: assetBlock,
  status: statusValue,
  as_of: z.string(),
  checked_at: nullableString,
  issuer_change_seen_at: nullableString,
  rules_version: z.string(),
  raised_flags: z.array(z.strictObject({ code: z.string(), severity: z.string(), statement: z.string(), as_of: z.string() })),
  counts,
  feed: z.strictObject({ network: z.string(), contract_id: z.string(), key: z.string(), evidence_hash: z.string() }).nullable(),
  fact_sheet: nullableString,
  paid_detail: z.strictObject({ path: z.string(), protocol: z.string(), network: z.string(), available: z.boolean() }),
  scope: z.string(),
  notice: z.string(),
  source_file: z.string(),
  note: z.string().optional(),
});

// ---------------------------------------------------------------- get_fact_sheet: fact-sheet/1

export const evidenceSchema = z.strictObject({
  kind: z.string(),
  ref: z.string(),
  source_url: nullableString,
  snapshot_sha256: nullableString,
  quote: nullableString,
  quote_truncated: z.boolean(),
  where: nullableString,
});

const inputRef = z.strictObject({ path: z.string(), date: nullableString, checked_at: nullableString }).nullable();

const flagBase = { flag: z.enum(flagNames), bit: z.number().int(), name: z.string() };

export const factSheetOutputSchema = z.strictObject({
  schema: z.literal(FACT_SHEET_SCHEMA),
  asset: assetBlock,
  status: statusValue,
  summary: z.string(),
  counts,
  as_of: z.string(),
  computed_at: z.string(),
  checked_at: nullableString,
  issuer_change_seen_at: nullableString,
  rules_version: z.string(),
  flags: z.strictObject({
    raised: z.array(
      z.strictObject({
        ...flagBase,
        severity: z.enum(["WARNING", "CRITICAL"]),
        effective_severity: z.enum(["WARNING", "CRITICAL"]),
        review: z.enum(["not_needed", "pending", "confirmed", "rejected"]),
        review_note: nullableString,
        statement: z.string(),
        as_of: z.string(),
        evidence: z.array(evidenceSchema),
      }),
    ),
    clear: z.array(z.strictObject({ ...flagBase, reason: z.string(), as_of: z.string(), evidence: z.array(evidenceSchema) })),
    not_evaluated: z.array(z.strictObject({ ...flagBase, reason: z.string() })),
  }),
  inputs: z.strictObject({ checks: inputRef, previous_checks: inputRef, examinations: inputRef }),
  feed: z
    .strictObject({
      network: z.string(),
      contract_id: nullableString,
      key: nullableString,
      flags_bitmask: z.number().int(),
      flags_binary: z.string(),
      evidence_hash: z.string(),
    })
    .nullable(),
  links: z.strictObject({
    fact_sheet: z.strictObject({ en: z.string(), id: z.string() }).nullable(),
    horizon: nullableString,
    explorer: nullableString,
  }),
  method: z.array(z.string()),
  text_note: z.string(),
  untrusted_text: z.string(),
  disclaimer: z.string(),
  notice: z.string(),
  source_file: z.string(),
});

// ---------------------------------------------------------------- list_flags: flag-list/1

export const flagListOutputSchema = z.strictObject({
  schema: z.literal(FLAG_LIST_SCHEMA),
  as_of: z.string(),
  rules_version: z.string(),
  source_file: z.string(),
  filters: z.strictObject({ flag: z.enum(flagNames).nullable(), severity: z.enum(["WARNING", "CRITICAL"]).nullable() }),
  status_counts: z.record(z.string(), z.number()),
  flags: z.array(
    z.strictObject({
      flag: z.enum(flagNames),
      bit: z.number().int(),
      name: z.string(),
      checks: z.string(),
      raised: z.number().int(),
      clear: z.number().int(),
      not_evaluated: z.number().int(),
    }),
  ),
  raised: z.strictObject({
    total: z.number().int(),
    returned: z.number().int(),
    truncated: z.boolean(),
    items: z.array(
      z.strictObject({
        asset_code: z.string(),
        issuer: z.string(),
        issuer_org: z.string(),
        asset_status: statusValue,
        flag: z.enum(flagNames),
        bit: z.number().int(),
        severity: z.enum(["WARNING", "CRITICAL"]),
        effective_severity: z.enum(["WARNING", "CRITICAL"]),
        review: z.enum(["not_needed", "pending", "confirmed", "rejected"]),
        statement: z.string(),
        as_of: z.string(),
        fact_sheet: nullableString,
      }),
    ),
  }),
  scope: z.string(),
  notice: z.string(),
});

export type CheckSummaryOutput = z.infer<typeof checkSummaryOutputSchema>;
export type FactSheetOutput = z.infer<typeof factSheetOutputSchema>;
export type FlagListOutput = z.infer<typeof flagListOutputSchema>;
