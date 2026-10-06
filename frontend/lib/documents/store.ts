/**
 * Content-addressed snapshot store (golden rule 2: every claim cites the
 * SHA-256 of the exact document bytes it was read from).
 *
 *   <dir>/blobs/<sha256>       exact bytes as fetched (git-ignored)
 *   <dir>/text/<sha256>.txt    extracted text; PDF pages separated by \f (git-ignored)
 *   <dir>/index.json           one record per (url, sha256), committed as evidence
 *
 * A changed document gets a new record; an unchanged one only updates lastSeenAt.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type SourceClass = "issuer" | "issuer_toml" | "regulatory_filing";

export type FilingInfo = { cik: string; seriesId?: string; form: string; accession: string; filedAt: string };

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
  text: { kind: "pdf" | "html" | "xml" | "text"; chars: number; pages: number | null } | null;
  fetchedAt: string;
  lastSeenAt: string;
};

export const DEFAULT_SNAPSHOTS_DIR = path.join(process.cwd(), "..", "data", "snapshots");

export function sha256Hex(bytes: Uint8Array | string) {
  return createHash("sha256").update(bytes).digest("hex");
}

export const assetKey = (code: string, issuer: string) => `${code}:${issuer}`;

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
    return this.records.find((r) => r.url === url && r.sha256 === sha256);
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
    now?: string;
  }): SnapshotRecord {
    const now = input.now ?? new Date().toISOString();
    const sha256 = sha256Hex(input.bytes);
    const blob = path.join(this.dir, "blobs", sha256);
    if (!fs.existsSync(blob)) writeAtomic(blob, input.bytes);
    if (input.text && !fs.existsSync(this.textPath(sha256))) writeAtomic(this.textPath(sha256), input.text.value);

    const existing = this.find(input.url, sha256);
    if (existing) {
      existing.lastSeenAt = now;
      if (!existing.assets.includes(input.asset)) existing.assets.push(input.asset);
      return existing;
    }
    const record: SnapshotRecord = {
      sha256,
      url: input.url,
      finalUrl: input.finalUrl,
      contentType: input.contentType,
      bytes: input.bytes.byteLength,
      sourceClass: input.sourceClass,
      assets: [input.asset],
      discoveredFrom: input.discoveredFrom,
      ...(input.filing ? { filing: input.filing } : {}),
      text: input.text ? { kind: input.text.kind, chars: input.text.value.length, pages: input.text.pages } : null,
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

  flush() {
    const sorted = [...this.records].sort((a, b) => a.url.localeCompare(b.url) || a.fetchedAt.localeCompare(b.fetchedAt));
    writeAtomic(path.join(this.dir, "index.json"), JSON.stringify(sorted, null, 2) + "\n");
  }
}
