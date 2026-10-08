/**
 * Claims storage (committed as evidence):
 *
 *   data/claims/claims.json   verified claims (the Claim record in internal/product.md)
 *   data/claims/dropped.json  proposed claims that failed verification, with the reason
 *   data/claims/runs.json     one entry per document and extraction config, with the raw
 *                             proposals, so the verifier can be re-run without the LLM
 *
 * A document is identified by its snapshot hash plus the assets it is about
 * (`doc_key`); the same bytes served for different assets are separate docs.
 * A run (success or failure) is never repeated for the same config key
 * (golden rule 11) unless forced.
 */
import fs from "node:fs";
import path from "node:path";
import type { ClaimField, ProposedClaim } from "./fields";
import type { DropReason } from "./verify";

/** Who chose the field label and quote; the quote, value, as-of date, page, and unit are always verified by code. */
export type ClaimFieldSource = "llm" | "operator-reviewed";

export type Claim = {
  id: string;
  doc_key: string;
  asset: string; // CODE:ISSUER, or ISSUER:<official domain> for issuer-level facts
  field: ClaimField;
  /** The field label is the LLM's or the operator's judgement, gated by FIELD_GATES; everything else is checked by code. */
  field_source: ClaimFieldSource;
  value: number | string;
  /** The document's own characters at the matched spot. */
  value_text: string;
  /** Currency read from the document around the value (code), or null. */
  unit: string | null;
  as_of: string | null;
  quote: string;
  source_url: string;
  source_class: string;
  page: number | null;
  snapshot_sha256: string;
  text_sha256: string;
  extractor: string;
  model: string;
  prompt_version: string;
  /** The quote, value, and as-of date were verified against the snapshot text. */
  verified: true;
  extracted_at: string;
};

export type DroppedClaim = {
  doc_key: string;
  snapshot_sha256: string;
  source_url: string;
  reason: DropReason;
  field: string;
  asset_code: string;
  value_text: string;
  quote: string;
  model: string;
  prompt_version: string;
  extracted_at: string;
};

export type ExtractionRun = {
  key: string;
  doc_key: string;
  snapshot_sha256: string;
  text_sha256: string;
  source_url: string;
  chunks_sent: number;
  chars_sent: number;
  proposals: ProposedClaim[];
  verified: number;
  dropped: number;
  tokens: number | null;
  /** Set when the LLM call failed; the run is not retried unless forced. */
  error: string | null;
  model: string;
  prompt_version: string;
  at: string;
};

export const DEFAULT_CLAIMS_DIR = path.join(process.cwd(), "..", "data", "claims");

export function docKey(snapshotSha256: string, assets: string[]) {
  return `${snapshotSha256}|${[...assets].sort().join(",")}`;
}

function readJson<T>(file: string, fallback: T): T {
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as T) : fallback;
}

function writeJson(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

export class ClaimStore {
  claims: Claim[];
  dropped: DroppedClaim[];
  runs: ExtractionRun[];

  constructor(readonly dir: string = process.env.CLAIMS_DIR || DEFAULT_CLAIMS_DIR) {
    this.claims = readJson(path.join(dir, "claims.json"), []);
    this.dropped = readJson(path.join(dir, "dropped.json"), []);
    this.runs = readJson(path.join(dir, "runs.json"), []);
  }

  hasRun(key: string) {
    return this.runs.some((r) => r.key === key);
  }

  /** Replace the LLM claims, drops, and run stored for this document; operator-reviewed claims stay. */
  record(run: ExtractionRun, claims: Claim[], dropped: DroppedClaim[]) {
    this.claims = [...this.claims.filter((c) => c.doc_key !== run.doc_key || c.field_source !== "llm"), ...claims];
    this.dropped = [...this.dropped.filter((d) => d.doc_key !== run.doc_key), ...dropped];
    this.runs = [...this.runs.filter((r) => r.doc_key !== run.doc_key), run];
  }

  /** Replace only the operator-reviewed claims of this document. Operator drops are not stored here (dropped.json is LLM-only). */
  recordReview(docKey: string, claims: Claim[]) {
    this.removeReview(docKey);
    this.claims = [...this.claims, ...claims];
  }

  removeReview(docKey: string) {
    this.claims = this.claims.filter((c) => c.doc_key !== docKey || c.field_source !== "operator-reviewed");
  }

  /** Keep operator-reviewed claims only for these documents (the ones with a valid, imported proposals file). */
  retainReview(liveDocKeys: ReadonlySet<string>) {
    this.claims = this.claims.filter((c) => c.field_source !== "operator-reviewed" || liveDocKeys.has(c.doc_key));
  }

  flush() {
    const byDoc = <T extends { doc_key: string }>(a: T, b: T) => a.doc_key.localeCompare(b.doc_key);
    writeJson(
      path.join(this.dir, "claims.json"),
      [...this.claims].sort((a, b) => a.asset.localeCompare(b.asset) || a.field.localeCompare(b.field) || a.id.localeCompare(b.id)),
    );
    writeJson(path.join(this.dir, "dropped.json"), [...this.dropped].sort(byDoc));
    writeJson(path.join(this.dir, "runs.json"), [...this.runs].sort(byDoc));
  }
}
