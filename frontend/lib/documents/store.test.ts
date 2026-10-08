import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SnapshotStore, assetKey, currentRecords, redactUrl, sha256Hex, type SnapshotRecord } from "./store";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "snapshots-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const enc = (s: string) => new TextEncoder().encode(s);
const input = (body: string, asset = "BENJI:GA", now = "2026-10-06T00:00:00.000Z") => ({
  bytes: enc(body),
  url: "https://example.com/doc.pdf",
  finalUrl: "https://example.com/doc.pdf",
  contentType: "application/pdf",
  sourceClass: "issuer" as const,
  asset,
  discoveredFrom: null,
  text: { kind: "pdf" as const, value: `text of ${body}`, pages: 1 },
  extractor: "test-v1",
  now,
});

describe("SnapshotStore", () => {
  it("names blobs by the SHA-256 of their exact bytes and stores the text", () => {
    const store = new SnapshotStore(dir);
    const r = store.save(input("v1"));
    expect(r.sha256).toBe(sha256Hex(enc("v1")));
    expect(store.verifyBlob(r.sha256)).toBe(true);
    expect(store.readText(r.sha256)).toBe("text of v1");
    expect(r.text).toEqual({ kind: "pdf", chars: 10, pages: 1, sha256: sha256Hex("text of v1"), extractor: "test-v1" });
  });

  it("refreshes an unchanged document and adds a record for a changed one", () => {
    const store = new SnapshotStore(dir);
    store.save(input("v1"));
    const again = store.save(input("v1", "USDY:GB", "2026-10-07T00:00:00.000Z"));
    expect(store.all()).toHaveLength(1);
    expect(again.fetchedAt).toBe("2026-10-06T00:00:00.000Z");
    expect(again.lastSeenAt).toBe("2026-10-07T00:00:00.000Z");
    expect(again.assets).toEqual(["BENJI:GA", "USDY:GB"]);
    store.save(input("v2"));
    expect(store.all()).toHaveLength(2);
  });

  it("persists the index and reloads it", () => {
    const store = new SnapshotStore(dir);
    store.save(input("v1"));
    store.flush();
    const reloaded = new SnapshotStore(dir);
    expect(reloaded.all()).toHaveLength(1);
    expect(reloaded.all()[0].url).toBe("https://example.com/doc.pdf");
  });

  it("detects a tampered blob", () => {
    const store = new SnapshotStore(dir);
    const r = store.save(input("v1"));
    fs.writeFileSync(path.join(dir, "blobs", r.sha256), "tampered");
    expect(store.verifyBlob(r.sha256)).toBe(false);
  });

  it("rewrites the text and its hash when a new extractor gives different output", () => {
    const store = new SnapshotStore(dir);
    store.save(input("v1"));
    const r = store.save({ ...input("v1"), text: { kind: "pdf", value: "new text", pages: 1 }, extractor: "test-v2" });
    expect(store.all()).toHaveLength(1);
    expect(store.readText(r.sha256)).toBe("new text");
    expect(r.text?.extractor).toBe("test-v2");
    expect(r.text?.sha256).toBe(sha256Hex("new text"));
  });

  it("redacts access keys in stored URLs and still de-duplicates", () => {
    const store = new SnapshotStore(dir);
    const url = "https://www.dropbox.com/scl/fo/abc?rlkey=SECRET&st=xyz&dl=0";
    const r = store.save({ ...input("v1"), url, finalUrl: url, discoveredFrom: "https://s3.amazonaws.com/b/doc.pdf?X-Amz-Signature=abc&x=1" });
    expect(r.url).toBe("https://www.dropbox.com/scl/fo/abc?rlkey=REDACTED&st=REDACTED&dl=0");
    expect(r.discoveredFrom).toBe("https://s3.amazonaws.com/b/doc.pdf?X-Amz-Signature=REDACTED&x=1");
    store.save({ ...input("v1"), url, finalUrl: url });
    expect(store.all()).toHaveLength(1);
    expect(JSON.stringify(store.all())).not.toContain("SECRET");
    expect(redactUrl("not a url")).toBe("not a url");
    expect(redactUrl("https://storage.googleapis.com/b/o.pdf?X-Goog-Signature=a&X-Goog-Credential=b&api_key=c&apikey=d&auth=e&page=2")).toBe(
      "https://storage.googleapis.com/b/o.pdf?X-Goog-Signature=REDACTED&X-Goog-Credential=REDACTED&api_key=REDACTED&apikey=REDACTED&auth=REDACTED&page=2",
    );
  });

  it("never attaches an asset to a record of another source class", () => {
    const store = new SnapshotStore(dir);
    const official = store.save({ ...input("toml"), sourceClass: "issuer_toml", asset: "BB1:GOFFICIAL" });
    const spoof = store.save({ ...input("toml"), sourceClass: "third_party_toml", asset: "BB1:GSPOOF" });
    expect(spoof).toBe(official);
    expect(official.sourceClass).toBe("issuer_toml");
    expect(official.assets).toEqual(["BB1:GOFFICIAL"]);
    expect(store.all()).toHaveLength(1);
  });

  it("removes records by predicate", () => {
    const store = new SnapshotStore(dir);
    store.save(input("v1"));
    store.save({ ...input("v2"), sourceClass: "third_party_toml" });
    expect(store.remove((r) => r.sourceClass === "third_party_toml")).toBe(1);
    expect(store.all()).toHaveLength(1);
  });

  it("builds asset keys", () => {
    expect(assetKey("BENJI", "GA")).toBe("BENJI:GA");
  });
});

describe("currentRecords", () => {
  const rec = (over: Partial<SnapshotRecord>): SnapshotRecord => ({
    sha256: "a", url: "https://example.com/a", finalUrl: "https://example.com/a", contentType: "text/html", bytes: 1, sourceClass: "issuer",
    assets: ["X:G"], discoveredFrom: null, text: null, fetchedAt: "2026-10-01T00:00:00.000Z", lastSeenAt: "2026-10-01T00:00:00.000Z", ...over,
  });
  const filing = (form: string, filedAt: string) => ({ cik: "1", form, accession: filedAt, filedAt });

  it("keeps the record seen last for each URL", () => {
    const old = rec({ sha256: "old", lastSeenAt: "2026-10-01T00:00:00.000Z" });
    const fresh = rec({ sha256: "new", lastSeenAt: "2026-10-05T00:00:00.000Z" });
    expect(currentRecords([fresh, old])).toEqual([fresh]);
  });

  it("keeps only the newest filing per asset and form, treating an amendment as the same form", () => {
    const base = { sourceClass: "regulatory_filing" as const };
    const a = rec({ ...base, sha256: "f1", url: "https://sec.gov/1", filing: filing("N-MFP3", "2026-08-04") });
    const b = rec({ ...base, sha256: "f2", url: "https://sec.gov/2", filing: filing("N-MFP3/A", "2026-09-04") });
    const other = rec({ ...base, sha256: "f3", url: "https://sec.gov/3", filing: filing("NPORT-P", "2026-01-01") });
    const elsewhere = rec({ ...base, sha256: "f4", url: "https://sec.gov/4", assets: ["Y:G"], filing: filing("N-MFP3", "2026-08-04") });
    expect(currentRecords([a, b, other, elsewhere]).map((r) => r.sha256).sort()).toEqual(["f2", "f3", "f4"]);
  });
});
