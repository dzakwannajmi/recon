import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ClaimStore, runKey, type Claim, type ExtractionRun } from "./store";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "claims-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const run = (sha: string, key: string): ExtractionRun => ({
  key, snapshot_sha256: sha, source_url: "https://x.com/a.pdf", chunks_sent: 1, chars_sent: 10, proposed: 1, verified: 1, dropped: 0,
  tokens: 100, model: "m", prompt_version: "p", at: "2026-10-06T00:00:00.000Z",
});
const claim = (sha: string, id: string) => ({ id, snapshot_sha256: sha, asset: "BENJI:GA", field: "net_assets" }) as Claim;

describe("ClaimStore", () => {
  it("builds a cache key from snapshot, text, prompt, and model", () => {
    expect(runKey({ snapshotSha256: "s", textSha256: "t", promptVersion: "p", model: "m" })).toBe("s|t|p|m");
  });

  it("replaces an earlier run of the same snapshot and persists", () => {
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
