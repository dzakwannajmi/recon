/**
 * Turn verified proposals for one document into stored claims (pure, so it
 * can be tested): asset keys come only from the document's own asset list or
 * the issuers' pinned official domain, never from free text.
 */
import { createHash } from "node:crypto";
import type { SnapshotRecord } from "../documents/store";
import { MAX_CLAIMS_PER_DOCUMENT, type ProposedClaim } from "./fields";
import type { Claim, ClaimFieldSource, DroppedClaim } from "./store";
import type { DropReason, VerifiedValue } from "./verify";

export type BuildInput = {
  record: SnapshotRecord;
  docKey: string;
  /** Official domains (data/assets.csv) of the assets this document is about. */
  officialDomains: string[];
  proposals: ProposedClaim[];
  verify: (claim: ProposedClaim) => { ok: true; result: VerifiedValue } | { ok: false; reason: DropReason };
  model: string;
  promptVersion: string;
  now: string;
  /** Who chose the field label and quote. Operator-reviewed ids carry a suffix so they never collide with LLM ids. */
  fieldSource: ClaimFieldSource;
};

export function buildClaims(input: BuildInput): { claims: Claim[]; dropped: DroppedClaim[] } {
  const { record } = input;
  const claims: Claim[] = [];
  const dropped: DroppedClaim[] = [];
  const drop = (claim: ProposedClaim, reason: DropReason) =>
    dropped.push({
      doc_key: input.docKey, snapshot_sha256: record.sha256, source_url: record.url, reason, field: claim.field, asset_code: claim.asset_code,
      value_text: claim.value_text, quote: claim.quote, model: input.model, prompt_version: input.promptVersion, extracted_at: input.now,
    });

  const issuerDomains = [...new Set(input.officialDomains)];
  input.proposals.forEach((claim, i) => {
    if (i >= MAX_CLAIMS_PER_DOCUMENT) return drop(claim, "over_cap");
    const check = input.verify(claim);
    if (!check.ok) return drop(claim, check.reason);

    let asset: string | undefined;
    if (claim.asset_code === "ISSUER") {
      if (issuerDomains.length !== 1) return drop(claim, "issuer_ambiguous");
      asset = `ISSUER:${issuerDomains[0]}`;
    } else {
      asset = record.assets.find((k) => k.split(":")[0] === claim.asset_code);
      if (!asset) return drop(claim, "attribution_unverified");
    }

    const { value, value_text, unit, as_of, page } = check.result;
    // The same fact stated twice in one document is stored once.
    if (claims.some((c) => c.asset === asset && c.field === claim.field && c.value === value && c.as_of === as_of)) return;
    const idParts = [input.docKey, asset, claim.field, claim.quote, String(value)];
    if (input.fieldSource === "operator-reviewed") idParts.push("operator-reviewed");
    const id = createHash("sha256").update(idParts.join("|")).digest("hex").slice(0, 16);
    claims.push({
      id, doc_key: input.docKey, asset, field: claim.field, field_source: input.fieldSource, value, value_text, unit, as_of, quote: claim.quote,
      source_url: record.url, source_class: record.sourceClass, page, snapshot_sha256: record.sha256, text_sha256: record.text!.sha256,
      extractor: record.text!.extractor, model: input.model, prompt_version: input.promptVersion, verified: true, extracted_at: input.now,
    });
  });
  return { claims, dropped };
}
