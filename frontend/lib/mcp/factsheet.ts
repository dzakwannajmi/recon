/**
 * The fact sheet as data (`fact-sheet/1`, spec 4.3): the public page /en/assets/{code} without the markup.
 * Pure projection of the stored status file. Statements and reasons are copied byte for byte; nothing here
 * computes a status or a flag (golden rule 1). Quotes are verbatim, cut only at 1,000 code points and marked.
 */
import type { UniverseAsset } from "../chain/universe";
import { factSheetPath } from "../agent-data/assets";
import { COPY } from "../factsheet/copy";
import type { EvidenceRef } from "../flags/types";
import { FLAG_BITS } from "../flags/types";
import type { LoadedAsset, LoadedStatus, StatusInput } from "../factsheet/load";
import { bitmaskBinary, counts, explorerLinks, fmt, inputDate, safeHttpUrl } from "../factsheet/view";
import { NOTICE, UNTRUSTED_NOTE } from "../gateway/copy";
import { cutCodePoints } from "../gateway/text";
import { FEED_NETWORK } from "../gateway/summary";
import { MAX_EVIDENCE_PER_FLAG, MAX_QUOTE_CODE_POINTS } from "./limits";
import { FACT_SHEET_SCHEMA, type FactSheetOutput } from "./schemas";

type Evidence = FactSheetOutput["flags"]["raised"][number]["evidence"][number];

function evidenceItem(e: EvidenceRef): Evidence {
  const q = typeof e.quote === "string" ? cutCodePoints(e.quote, MAX_QUOTE_CODE_POINTS) : null;
  return {
    kind: e.kind,
    ref: e.ref,
    source_url: safeHttpUrl(e.source_url),
    snapshot_sha256: e.snapshot_sha256 ?? null,
    quote: q ? q.text : null,
    quote_truncated: q ? q.truncated : false,
    where: e.where ?? null,
  };
}

const evidenceList = (list: readonly EvidenceRef[] | undefined): Evidence[] => (list ?? []).slice(0, MAX_EVIDENCE_PER_FLAG).map(evidenceItem);

const inputRef = (input: StatusInput | undefined) => (input ? { path: input.path, date: inputDate(input.path), checked_at: input.checked_at ?? null } : null);

const REVIEW_NOTES = ["pending", "confirmed", "rejected"] as const;

export type FactSheetInput = {
  asset: LoadedAsset;
  row: UniverseAsset | null;
  codeIsUnique: boolean;
  status: LoadedStatus;
  /** The testnet feed deployment, or null when its record cannot be read. */
  deployment: { contract_id: string } | null;
};

export function buildFactSheet({ asset, row, codeIsUnique, status, deployment }: FactSheetInput): FactSheetOutput {
  const copy = COPY.en;
  const c = counts(asset);
  const links = explorerLinks(asset.asset_code, asset.issuer);
  const file = status.status;
  return {
    schema: FACT_SHEET_SCHEMA,
    asset: {
      code: asset.asset_code,
      issuer: asset.issuer,
      issuer_org: asset.issuer_org,
      type: asset.asset_type,
      official_domain: row?.official_domain || null,
      sac_contract_id: asset.sac_contract_id ?? null,
    },
    status: asset.status,
    summary: fmt(asset.status ? copy.status[asset.status] : copy.status.unpublished, c),
    counts: c,
    as_of: file.as_of,
    computed_at: file.generated_at,
    checked_at: asset.checked_at ?? null,
    issuer_change_seen_at: asset.issuer_change_seen_at ?? null,
    rules_version: file.rules_version,
    flags: {
      raised: asset.raised.map((f) => ({
        flag: f.flag,
        bit: FLAG_BITS[f.flag],
        name: copy.flags[f.flag].name,
        severity: f.severity,
        effective_severity: f.effective_severity,
        review: f.review,
        review_note: (REVIEW_NOTES as readonly string[]).includes(f.review) ? copy.review[f.review as (typeof REVIEW_NOTES)[number]] : null,
        statement: f.statement,
        as_of: f.as_of,
        evidence: evidenceList(f.evidence),
      })),
      clear: asset.clear.map((f) => ({
        flag: f.flag,
        bit: FLAG_BITS[f.flag],
        name: copy.flags[f.flag].name,
        reason: f.reason,
        as_of: f.as_of,
        evidence: evidenceList(f.evidence),
      })),
      not_evaluated: asset.not_evaluated.map((f) => ({
        flag: f.flag,
        bit: FLAG_BITS[f.flag],
        name: copy.flags[f.flag].name,
        reason: f.reason,
      })),
    },
    inputs: { checks: inputRef(file.inputs.checks), previous_checks: inputRef(file.inputs.previous_checks), examinations: inputRef(file.inputs.examinations) },
    // An asset without a chain check is not in the feed (the same rule as the free summary).
    feed:
      asset.status === null
        ? null
        : {
            network: FEED_NETWORK,
            contract_id: deployment?.contract_id ?? null,
            key: asset.sac_contract_id ?? null,
            flags_bitmask: asset.flags_bitmask,
            flags_binary: bitmaskBinary(asset.flags_bitmask),
            evidence_hash: asset.evidence_hash,
          },
    links: {
      fact_sheet: codeIsUnique ? { en: factSheetPath(asset.asset_code), id: factSheetPath(asset.asset_code).replace(/^\/en\//, "/id/") } : null,
      horizon: links?.horizon ?? null,
      explorer: links?.explorer ?? null,
    },
    method: [...copy.method.steps],
    text_note: copy.computedTextNote,
    untrusted_text: UNTRUSTED_NOTE,
    disclaimer: copy.disclaimer,
    notice: NOTICE,
    source_file: `data/status/${status.file}`,
  };
}
