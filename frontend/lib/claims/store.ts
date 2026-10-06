/**
 * Claims storage (committed as evidence):
 *
 *   data/claims/claims.json   verified claims (the Claim record in internal/product.md)
 *   data/claims/dropped.json  proposed claims that failed verification, with the reason
 *   data/claims/runs.json     one entry per extraction run, keyed by snapshot + text + prompt + model;
 *                             a document is never sent to the LLM twice for the same key (golden rule 11)
 */
import fs from "node:fs";
import path from "node:path";
import type { ClaimField } from "./fields";
import type { DropReason } from "./verify";

export type Claim = {
  id: string;
  asset: string; // CODE:ISSUER, or ISSUER:<org> for issuer-level facts
  field: ClaimField;
  value: number | string;
  value_text: string;
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
  verified: true;
  extracted_at: string;
};

export type DroppedClaim = {
  snapshot_sha256: string;
  source_url: string;
  reason: DropReason | "schema_invalid";
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
  snapshot_sha256: string;
  source_url: string;
  chunks_sent: number;
  chars_sent: number;
  proposed: number;
  verified: number;
  dropped: number;
  tokens: number | null;
  model: string;
  prompt_version: string;
  at: string;
};

export const DEFAULT_CLAIMS_DIR = path.join(process.cwd(), "..", "data", "claims");

export function runKey(input: { snapshotSha256: string; textSha256: string; promptVersion: string; model: string }) {
  return [input.snapshotSha256, input.textSha256, input.promptVersion, input.model].join("|");
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

  /** Replace everything from an earlier run of the same snapshot (e.g. after a prompt change). */
  record(run: ExtractionRun, claims: Claim[], dropped: DroppedClaim[]) {
    this.claims = [...this.claims.filter((c) => c.snapshot_sha256 !== run.snapshot_sha256), ...claims];
    this.dropped = [...this.dropped.filter((d) => d.snapshot_sha256 !== run.snapshot_sha256), ...dropped];
    this.runs = [...this.runs.filter((r) => r.snapshot_sha256 !== run.snapshot_sha256), run];
  }

  flush() {
    const byKey = <T extends { snapshot_sha256: string }>(a: T, b: T) => a.snapshot_sha256.localeCompare(b.snapshot_sha256);
    writeJson(path.join(this.dir, "claims.json"), [...this.claims].sort((a, b) => a.asset.localeCompare(b.asset) || a.field.localeCompare(b.field) || a.id.localeCompare(b.id)));
    writeJson(path.join(this.dir, "dropped.json"), [...this.dropped].sort(byKey));
    writeJson(path.join(this.dir, "runs.json"), [...this.runs].sort(byKey));
  }
}
