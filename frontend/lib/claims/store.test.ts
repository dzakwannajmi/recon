import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ClaimStore, docKey, type Claim, type ExtractionRun } from "./store";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "claims-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const run = (doc: string, key: string): ExtractionRun => ({
  key, doc_key: doc, snapshot_sha256: doc, text_sha256: "t", source_url: "https://x.com/a.pdf", chunks_sent: 1, chars_sent: 10, proposals: [],
  verified: 1, dropped: 0, tokens: 100, error: null, model: "m", prompt_version: "p", at: "2026-10-06T00:00:00.000Z",
});
const claim = (doc: string, id: string) => ({ id, doc_key: doc, asset: "BENJI:GA", field: "net_assets" }) as Claim;

describe("ClaimStore", () => {
  it("identifies a document by snapshot hash and its sorted assets", () => {
    expect(docKey("s", ["B:2", "A:1"])).toBe("s|A:1,B:2");
  });

  it("replaces an earlier run of the same document and persists", () => {
    const store = new ClaimStore(dir);
    store.record(run("a", "a|1"), [claim("a", "old")], []);
    store.record(run("b", "b|1"), [claim("b", "keep")], []);
    store.record(run("a", "a|2"), [claim("a", "new")], []);
    store.flush();
    const reloaded = new ClaimStore(dir);
    expect(reloaded.claims.map((c) => c.id).sort()).toEqual(["keep", "new"]);
    expect(reloaded.hasRun("a|2")).toBe(true);
    expect(reloaded.hasRun("a|1")).toBe(false);
  });
});
