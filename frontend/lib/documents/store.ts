/**
 * Content-addressed snapshot store (golden rule 2: every claim cites the
 * SHA-256 of the exact document bytes it was read from).
 *
 *   <dir>/blobs/<sha256>       exact bytes as fetched (git-ignored)
 *   <dir>/text/<sha256>.txt    extracted text; PDF pages separated by \f (git-ignored)
 *   <dir>/index.json           one record per (url, sha256), committed as evidence
 *
 * A changed document gets a new record; an unchanged one only updates lastSeenAt.
 * Each record keeps the SHA-256 of its extracted text and the extractor
 * version, so the quote verifier can refuse text from a different extractor.
 * URLs are stored with access-key query values redacted.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** `third_party_toml`: a toml read only to compare it with an issuer's (never an issuer claim). */
export type SourceClass = "issuer" | "issuer_toml" | "regulatory_filing" | "third_party_toml";

export type FilingInfo = { cik: string; seriesId?: string; form: string; accession: string; filedAt: string };

export type TextInfo = {
  kind: "pdf" | "html" | "xml" | "text";
  chars: number;
  pages: number | null;
  sha256: string;
  extractor: string;
};

export type SnapshotRecord = {
  sha256: string;
  url: string;
  finalUrl: string;
  contentType: string;
  bytes: number;
  sourceClass: SourceClass;
  /** `CODE:ISSUER` keys of the assets this document is about. */
  assets: string[];
  /** The official page or file that published the link (null for seeds pinned in data files). */
  discoveredFrom: string | null;
  filing?: FilingInfo;
  text: TextInfo | null;
  fetchedAt: string;
  lastSeenAt: string;
};

export const DEFAULT_SNAPSHOTS_DIR = path.join(process.cwd(), "..", "data", "snapshots");

export function sha256Hex(bytes: Uint8Array | string) {
  return createHash("sha256").update(bytes).digest("hex");
}

export const assetKey = (code: string, issuer: string) => `${code}:${issuer}`;

const SECRET_PARAM = /^(rlkey|st|sig|signature|token|key|api_?key|auth|access_token|x-amz-.+|x-goog-.+)$/i;

/** Replace the values of access-key query parameters (Dropbox rlkey, S3 signatures, tokens) with REDACTED. */
export function redactUrl(url: string): string;
export function redactUrl(url: string | null): string | null;
export function redactUrl(url: string | null) {
  if (url === null) return null;
  try {
    const u = new URL(url);
    for (const name of [...u.searchParams.keys()]) if (SECRET_PARAM.test(name)) u.searchParams.set(name, "REDACTED");
    return u.toString();
  } catch {
    return url;
  }
}

/** The newest record per URL, then per asset and filing form the newest report. */
export function currentRecords(records: readonly SnapshotRecord[]): SnapshotRecord[] {
  const byUrl = new Map<string, SnapshotRecord>();
  for (const r of records) {
    const seen = byUrl.get(r.url);
    if (!seen || r.lastSeenAt > seen.lastSeenAt) byUrl.set(r.url, r);
  }
  const latest = [...byUrl.values()];
  return latest.filter((r) => {
    if (r.sourceClass !== "regulatory_filing" || !r.filing) return true;
    const form = r.filing.form.replace(/\/A$/, "");
    return !latest.some(
      (o) => o !== r && o.filing && o.filing.form.replace(/\/A$/, "") === form && o.assets.some((a) => r.assets.includes(a)) && o.filing.filedAt > r.filing!.filedAt,
    );
  });
}

function writeAtomic(file: string, data: Uint8Array | string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

export class SnapshotStore {
  private records: SnapshotRecord[];

  constructor(readonly dir: string = process.env.SNAPSHOTS_DIR || DEFAULT_SNAPSHOTS_DIR) {
    const indexFile = path.join(dir, "index.json");
    this.records = fs.existsSync(indexFile) ? (JSON.parse(fs.readFileSync(indexFile, "utf8")) as SnapshotRecord[]) : [];
  }

  all(): readonly SnapshotRecord[] {
    return this.records;
  }

  find(url: string, sha256: string) {
    const key = redactUrl(url);
    return this.records.find((r) => r.url === key && r.sha256 === sha256);
  }

  /** Save the bytes and text (if new) and add or refresh the index record. */
  save(input: {
    bytes: Uint8Array;
    url: string;
    finalUrl: string;
    contentType: string;
    sourceClass: SourceClass;
    asset: string;
    discoveredFrom: string | null;
    filing?: FilingInfo;
    text: { kind: "pdf" | "html" | "xml" | "text"; value: string; pages: number | null } | null;
    extractor: string;
    now?: string;
  }): SnapshotRecord {
    const now = input.now ?? new Date().toISOString();
    const sha256 = sha256Hex(input.bytes);
    const url = redactUrl(input.url);
    const blob = path.join(this.dir, "blobs", sha256);
    if (!fs.existsSync(blob)) writeAtomic(blob, input.bytes);
    const text: TextInfo | null = input.text
      ? { kind: input.text.kind, chars: input.text.value.length, pages: input.text.pages, sha256: sha256Hex(input.text.value), extractor: input.extractor }
      : null;
    // Text is keyed by the blob hash; rewrite it when the extractor's output differs.
    if (input.text && (!fs.existsSync(this.textPath(sha256)) || this.readText(sha256) !== input.text.value)) {
      writeAtomic(this.textPath(sha256), input.text.value);
    }

    const existing = this.find(url, sha256);
    if (existing && existing.sourceClass !== input.sourceClass) {
      // The same bytes at the same URL were already stored as another source class (e.g. an issuer's
      // own toml): never attach another asset to that record. The caller can reuse its sha256.
      return existing;
    }
    if (existing) {
      existing.lastSeenAt = now;
      existing.text = text;
      if (!existing.assets.includes(input.asset)) existing.assets.push(input.asset);
      return existing;
    }
    const record: SnapshotRecord = {
      sha256,
      url,
      finalUrl: redactUrl(input.finalUrl),
      contentType: input.contentType,
      bytes: input.bytes.byteLength,
      sourceClass: input.sourceClass,
      assets: [input.asset],
      discoveredFrom: redactUrl(input.discoveredFrom),
      ...(input.filing ? { filing: input.filing } : {}),
      text,
      fetchedAt: now,
      lastSeenAt: now,
    };
    this.records.push(record);
    return record;
  }

  textPath(sha256: string) {
    return path.join(this.dir, "text", `${sha256}.txt`);
  }

  /** The extracted text of a snapshot, or null if none was stored. */
  readText(sha256: string) {
    const file = this.textPath(sha256);
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  }

  /** Re-hash a stored blob; true when the bytes still match their name. */
  verifyBlob(sha256: string) {
    const file = path.join(this.dir, "blobs", sha256);
    return fs.existsSync(file) && sha256Hex(fs.readFileSync(file)) === sha256;
  }

  /** Drop index records (bytes and text stay on disk); returns how many were removed. */
  remove(predicate: (r: SnapshotRecord) => boolean) {
    const before = this.records.length;
    this.records = this.records.filter((r) => !predicate(r));
    return before - this.records.length;
  }

  flush() {
    const sorted = [...this.records].sort((a, b) => a.url.localeCompare(b.url) || a.fetchedAt.localeCompare(b.fetchedAt));
    writeAtomic(path.join(this.dir, "index.json"), JSON.stringify(sorted, null, 2) + "\n");
  }
}
