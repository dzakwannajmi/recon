import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SnapshotStore, assetKey, sha256Hex } from "./store";

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
  now,
});

describe("SnapshotStore", () => {
  it("names blobs by the SHA-256 of their exact bytes and stores the text", () => {
    const store = new SnapshotStore(dir);
    const r = store.save(input("v1"));
    expect(r.sha256).toBe(sha256Hex(enc("v1")));
    expect(store.verifyBlob(r.sha256)).toBe(true);
    expect(store.readText(r.sha256)).toBe("text of v1");
    expect(r.text).toEqual({ kind: "pdf", chars: 10, pages: 1 });
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

  it("builds asset keys", () => {
    expect(assetKey("BENJI", "GA")).toBe("BENJI:GA");
  });
});
