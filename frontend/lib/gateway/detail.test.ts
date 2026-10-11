import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Claim } from "../claims/store";
import { createGatewayData } from "./data";
import { IntegrityError, MAX_DETAIL_BYTES, buildDetail, cutCodePoints, readOnchain, type OnchainCache } from "./detail";
import { toJsonText } from "./json";
import { entryFor, fakeReader, realAsset, realData } from "./testkit";
import { FLAG_ORDER } from "../flags/types";

const NOW = new Date("2026-10-10T12:00:00.000Z");

async function detailFor(code: string, over: { issuer?: string; reader?: ReturnType<typeof fakeReader> | null; data?: Partial<ReturnType<typeof realData>>; claims?: Claim[] } = {}) {
  const k = realAsset(code, over.issuer);
  const reader = over.reader === undefined ? fakeReader({ [k.asset.sac_contract_id as string]: entryFor(k.loaded, k.asset) }) : over.reader;
  const body = await buildDetail({
    asset: k.asset,
    row: k.row,
    loaded: k.loaded,
    claims: over.claims ?? k.data.claims(),
    universe: k.universe,
    data: { ...k.data, ...over.data },
    reader,
    now: NOW,
    onchainCache: new Map(),
  });
  return { body, k };
}

describe("buildDetail", () => {
  it("D1: lists all 9 flags in order, with the statement or reason verbatim and the listed evidence fields", async () => {
    const { body, k } = await detailFor("gBENJI");
    expect(body.schema).toBe("check-detail/1");
    expect(body.flags.map((f) => f.flag)).toEqual(FLAG_ORDER);
    for (const f of body.flags) {
      const raised = k.asset.raised.find((x) => x.flag === f.flag);
      const clear = k.asset.clear.find((x) => x.flag === f.flag);
      const ne = k.asset.not_evaluated.find((x) => x.flag === f.flag);
      if (raised) {
        expect(f).toMatchObject({ outcome: "raised", text: raised.statement, as_of: raised.as_of, severity: raised.severity, effective_severity: raised.effective_severity, review: raised.review });
      } else if (clear) {
        expect(f).toMatchObject({ outcome: "clear", text: clear.reason, severity: null, review: null });
      } else {
        expect(f).toMatchObject({ outcome: "not_evaluated", text: ne?.reason, as_of: null, evidence: [] });
      }
      for (const e of f.evidence) expect(Object.keys(e).sort()).toEqual(["kind", "quote", "ref", "snapshot_sha256", "source_url", "where"]);
    }
    expect(body.status).toMatchObject({ value: "WARNING", code: 1, flags_bitmask: 128, flags_binary: "010000000", as_of: "2026-10-09" });
    expect(body.asset).toMatchObject({ code: "gBENJI", issuer_org: "Franklin Templeton", official_domain: "franklintempleton.com" });
    expect(body.untrusted_text).toContain("verbatim");
    expect(body.generated_at).toBe(NOW.toISOString());
  });

  it("caps evidence at 10 items per flag", async () => {
    const k = realAsset("gBENJI");
    const raised = k.asset.raised[0];
    const many = { ...k.asset, raised: [{ ...raised, evidence: Array.from({ length: 14 }, (_, i) => ({ kind: "snapshot" as const, ref: `r${i}` })) }, ...k.asset.raised.slice(1)] };
    const body = await buildDetail({ asset: many, row: k.row, loaded: k.loaded, claims: [], universe: k.universe, data: k.data, reader: null, now: NOW });
    expect(body.flags.find((f) => f.flag === raised.flag)?.evidence).toHaveLength(10);
  });

  it("D2: claims for USDY start with the asset's own claims, keep quotes verbatim, and carry the snapshot hash", async () => {
    const { body, k } = await detailFor("USDY");
    expect(body.claims.total).toBeGreaterThan(0);
    expect(body.claims.returned).toBeLessThanOrEqual(25);
    const stored = k.data.claims();
    const abouts = body.claims.items.map((c) => c.about);
    expect(abouts).toEqual([...abouts].sort((a, b) => Number(a === "issuer") - Number(b === "issuer")));
    for (const item of body.claims.items) {
      expect(item.snapshot_sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(stored.some((c) => c.quote === item.quote && c.snapshot_sha256 === item.snapshot_sha256)).toBe(true);
      expect(item.quote_truncated).toBe(false);
    }
  });

  it("limits claims to 25 and cuts a quote at 1000 code points with quote_truncated", async () => {
    const k = realAsset("gBENJI");
    const long = "x".repeat(990) + "\u{1F600}".repeat(30);
    const claims = Array.from({ length: 30 }, (_, i) => ({ id: `c${i}`, asset: k.asset.asset, field: "custodian", field_source: "llm", value: "v", value_text: "v", unit: null, as_of: null, quote: i === 0 ? long : "short", source_url: "https://x.example/d.pdf", source_class: "issuer", page: null, snapshot_sha256: "a".repeat(64), text_sha256: "b".repeat(64), verified: true }) as unknown as Claim);
    const { body } = await detailFor("gBENJI", { claims });
    expect(body.claims).toMatchObject({ total: 30, returned: 25 });
    expect(Array.from(body.claims.items[0].quote)).toHaveLength(1000);
    expect(body.claims.items[0].quote_truncated).toBe(true);
    expect(body.claims.items[1].quote_truncated).toBe(false);
    expect(body.claims.items[0].page).toBeNull();
  });

  it("cutCodePoints never splits a surrogate pair", () => {
    expect(cutCodePoints("ab\u{1F600}cd", 3)).toEqual({ text: "ab\u{1F600}", truncated: true });
    expect(cutCodePoints("abc", 3)).toEqual({ text: "abc", truncated: false });
  });

  it("D3: a checks file that is not the one the status used gives chain_facts.available false and still succeeds", async () => {
    const real = realData();
    const input = real.status().status.inputs.checks;
    expect(input).not.toBeNull();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gw-"));
    try {
      fs.mkdirSync(path.join(tmp, "checks"));
      const rel = (input as { path: string }).path.replace(/^data\//, "");
      fs.writeFileSync(path.join(tmp, rel), JSON.stringify({ results: [] }));
      const other = createGatewayData(tmp);
      const { body } = await detailFor("gBENJI", { data: { checks: other.checks } });
      expect(body.chain_facts).toMatchObject({ available: false, reason: "checks file missing or not the one the status used" });
      const missing = await detailFor("gBENJI", { data: { checks: () => null } });
      expect(missing.body.chain_facts.available).toBe(false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("chain facts come from the matching checks row, with signers sorted and capped", async () => {
    const { body } = await detailFor("gBENJI");
    expect(body.chain_facts.available).toBe(true);
    if (!body.chain_facts.available) return;
    expect(body.chain_facts.source_file).toBe("data/checks/2026-10-09.json");
    expect(body.chain_facts.identity.status).toBe("verified");
    expect(body.chain_facts.facts.issuer_signers.length).toBeLessThanOrEqual(20);
    const weights = body.chain_facts.facts.issuer_signers.map((s) => s.weight);
    expect(weights).toEqual([...weights].sort((a, b) => b - a));
    expect(body.chain_facts.notes).toHaveLength(1);
  });

  it("D4: the body stays within 64 KB for every asset in the committed status file", async () => {
    const data = realData();
    const loaded = data.status();
    const universe = data.universe();
    expect(loaded.status.assets.length).toBeGreaterThanOrEqual(27);
    for (const a of loaded.status.assets) {
      if (a.status === null) continue;
      const row = universe.find((u) => u.asset_code === a.asset_code && u.issuer === a.issuer) ?? null;
      const body = await buildDetail({ asset: a, row, loaded, claims: data.claims(), universe, data, reader: fakeReader({ [a.sac_contract_id as string]: entryFor(loaded, a) }), now: NOW, onchainCache: new Map() });
      const bytes = Buffer.byteLength(toJsonText(body));
      expect(bytes, a.asset).toBeLessThanOrEqual(MAX_DETAIL_BYTES);
    }
  });

  it("D6: published_by comes from the feed log for a published asset", async () => {
    const { body } = await detailFor("gBENJI");
    expect(body.feed.published_by).toMatchObject({ ledger: 5131026, explorer: expect.stringMatching(/^https:\/\/stellar\.expert\/explorer\/testnet\/tx\//) });
    expect(body.feed.published_by?.tx_hash.startsWith("fbfb7097")).toBe(true);
    expect(body.evidence.reproduce).toContain(body.feed.published_by?.commit);
    expect(body.evidence.inputs.map((i) => i.name)).toEqual(expect.arrayContaining(["checks", "previous_checks", "claims", "checks_history"]));
    expect(body.evidence.inputs.every((i) => /^[0-9a-f]{64}$/.test(i.sha256))).toBe(true);
  });

  it("published_by is null when no logged record holds this hash", async () => {
    const { body } = await detailFor("gBENJI", { data: { publishedBy: () => null } });
    expect(body.feed.published_by).toBeNull();
    expect(body.evidence.reproduce).toContain("data/status/2026-10-09.json");
  });

  it("shows the matching entry as matches true and a different one with its diffs", async () => {
    const k = realAsset("gBENJI");
    const key = k.asset.sac_contract_id as string;
    const ok = await detailFor("gBENJI");
    expect(ok.body.feed.onchain).toMatchObject({ read: "ok", matches: true, diffs: [], entry: { version: 1, published_ledger: 5131026 } });
    expect(ok.body.feed.key).toBe(key);
    expect(ok.body.feed.expected).toMatchObject({ status: 1, flags: 128 });
    const bad = await detailFor("gBENJI", { reader: fakeReader({ [key]: entryFor(k.loaded, k.asset, { status: 0, flags: 0 }) }) });
    expect(bad.body.feed.onchain.matches).toBe(false);
    expect(bad.body.feed.onchain.diffs).toEqual(expect.arrayContaining([expect.stringContaining("status"), expect.stringContaining("flags")]));
    const none = await detailFor("gBENJI", { reader: fakeReader({}) });
    expect(none.body.feed.onchain).toMatchObject({ read: "not_found", entry: null, matches: false });
    const noReader = await detailFor("gBENJI", { reader: null });
    expect(noReader.body.feed.onchain).toMatchObject({ read: "unavailable", entry: null, matches: null, diffs: null });
  });

  it("throws an IntegrityError for a tampered evidence_hash, a missing flag, and a missing deployment", async () => {
    const k = realAsset("gBENJI");
    const tamper = (mut: (a: Record<string, unknown>) => void) => {
      const assets = k.loaded.status.assets.map((a) => {
        if (a.asset !== k.asset.asset) return a;
        const copy = structuredClone(a) as unknown as Record<string, unknown>;
        mut(copy);
        return copy as unknown as typeof a;
      });
      const loaded = { file: k.loaded.file, status: { ...k.loaded.status, assets } };
      return { loaded, asset: assets.find((a) => a.asset === k.asset.asset) as typeof k.asset };
    };
    const run = (t: ReturnType<typeof tamper>, data = k.data) =>
      buildDetail({ asset: t.asset, row: k.row, loaded: t.loaded, claims: [], universe: k.universe, data, reader: null, now: NOW });

    await expect(run(tamper((a) => { a.evidence_hash = "0".repeat(64); }))).rejects.toThrow(IntegrityError);
    await expect(run(tamper((a) => { a.clear = (a.clear as { flag: string }[]).filter((f) => f.flag !== "ISSUER_IDENTITY"); }))).rejects.toThrow(/ISSUER_IDENTITY|evidence_hash/);
    await expect(run(tamper(() => {}), { ...k.data, deployment: () => null })).rejects.toThrow(IntegrityError);
  });

  it("a missing flag entry alone is an integrity error", async () => {
    const k = realAsset("gBENJI");
    const stripped = { ...k.asset, clear: k.asset.clear.filter((f) => f.flag !== "ISSUER_IDENTITY") };
    await expect(buildDetail({ asset: stripped, row: k.row, loaded: k.loaded, claims: [], universe: k.universe, data: k.data, reader: null, now: NOW })).rejects.toThrow(/no entry for the flag ISSUER_IDENTITY/);
  });
});

describe("readOnchain (D5)", () => {
  const KEY = "CKEY";
  const entry = (n = 1) => ({ asset: KEY, version: 1, status: 0, flags: 0, evidence_hash: "a".repeat(64), as_of: BigInt(n), issuer_change_seen_at: 0n, published_ledger: n });

  it("reads an entry, and a missing key as not_found", async () => {
    const cache: OnchainCache = new Map();
    expect(await readOnchain(KEY, fakeReader({ [KEY]: entry() }), NOW, { cache })).toMatchObject({ read: "ok", entry: { published_ledger: 1 } });
    expect(await readOnchain("OTHER", fakeReader({}), NOW, { cache })).toMatchObject({ read: "not_found", entry: null });
  });

  it("serves a second read within 60 s from the cache, and reads again after", async () => {
    const cache: OnchainCache = new Map();
    const reader = fakeReader({ [KEY]: entry() });
    await readOnchain(KEY, reader, NOW, { cache });
    await readOnchain(KEY, reader, new Date(NOW.getTime() + 59_000), { cache });
    expect(reader.calls).toHaveLength(1);
    const later = await readOnchain(KEY, reader, new Date(NOW.getTime() + 60_000), { cache });
    expect(reader.calls).toHaveLength(2);
    expect(later.read_at).toBe(new Date(NOW.getTime() + 60_000).toISOString());
  });

  it("an RPC error or a timeout is unavailable and is not cached", async () => {
    const cache: OnchainCache = new Map();
    const failing = { async readEntries(): Promise<never> { throw new Error("rpc down"); } };
    expect(await readOnchain(KEY, failing, NOW, { cache })).toMatchObject({ read: "unavailable", entry: null });
    const hanging = { readEntries: () => new Promise<never>(() => {}) };
    expect(await readOnchain(KEY, hanging, NOW, { cache, deadlineMs: 10 })).toMatchObject({ read: "unavailable" });
    expect(cache.size).toBe(0);
    const reader = fakeReader({ [KEY]: entry() });
    expect(await readOnchain(KEY, reader, NOW, { cache })).toMatchObject({ read: "ok" });
  });
});
