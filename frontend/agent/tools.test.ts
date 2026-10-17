import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { pinnedIssuerNote, projectAssetList, projectAssetStatus } from "@/lib/agent-data/assets";
import { MAX_CLAIMS, MAX_QUOTE_CHARS, projectClaims, readClaims } from "@/lib/agent-data/claims";
import { loadUniverse, type UniverseAsset } from "@/lib/chain/universe";
import type { Claim } from "@/lib/claims/store";
import { FIELD_NAMES } from "@/lib/claims/fields";
import { asset, raisedFlag, statusFile } from "@/lib/factsheet/fixtures";
import { INSTRUCTIONS } from "./agent";
import { tools, withEscapedResults, type Tool } from "./tools";

const tool = (name: string) => tools.find((t) => t.name === name)!;
const run = (name: string, args: unknown) => tool(name).run(args, {}) as Promise<any>;
const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v));

const A = "GBHNGLLIE3KWGKCHIKMHJ5HVZHYIK7WTBE4QF5PLAKL4CJGSEU7HZIW5"; // BENJI issuer (real, valid checksum)
const OTHER = "GCRYUGD5NVARGXT56XEZI5CIFCQETYHAPQQTHO2O3IQZTHDH4LATMYWC";

const universe = [
  { asset_code: "AAA", issuer: A, home_domain: "a.example", official_domain: "a.example", asset_type: "fund", issuer_org: "Org One" },
  { asset_code: "BBB", issuer: OTHER, home_domain: "", official_domain: "b.example", asset_type: "bond", issuer_org: "" },
] as UniverseAsset[];

const claim = (i: number, over: Partial<Claim> = {}): Claim =>
  ({
    id: `c${i}`, doc_key: "d", asset: `AAA:${A}`, field: "custodian", field_source: "llm", value: "Bank", value_text: "Bank", unit: null, as_of: null,
    quote: `The custodian is Bank ${i}.`, source_url: "https://a.example/doc.pdf", source_class: "issuer", page: 3,
    snapshot_sha256: "ab".repeat(32), text_sha256: "cd", extractor: "x", model: "m", prompt_version: "p", verified: true, extracted_at: "2026-10-06",
    ...over,
  }) as Claim;

describe("list_assets", () => {
  it("joins the universe with the stored status and states the scope", () => {
    const status = statusFile([asset({ asset: `AAA:${A}`, status: "WARNING" })]);
    const out = projectAssetList(universe, status);
    expect(out.scope).toMatch(/Stablecoins .* out of scope/);
    expect(out.status_as_of).toBe("2026-10-08");
    expect(out.assets).toEqual([
      { code: "AAA", issuer: A, org: "Org One", type: "fund", home_domain: "a.example", status: "WARNING" },
      { code: "BBB", issuer: OTHER, org: null, type: "bond", home_domain: null, status: null },
    ]);
  });

  it("works without a status file", () => {
    const out = projectAssetList(universe, null);
    expect(out.assets.every((a) => a.status === null)).toBe(true);
    expect(out.note).toMatch(/No stored status file/);
  });

  it("lists the real universe", async () => {
    const out = await run("list_assets", {});
    expect(out.count).toBe(loadUniverse().length);
    expect(out.count).toBeGreaterThan(20);
    expect(Object.keys(out.assets[0]).sort()).toEqual(["code", "home_domain", "issuer", "org", "status", "type"]);
    expect(out.assets.find((a: any) => a.code === "USTRY").status).toMatch(/^(OK|WARNING|CRITICAL)$/);
  });
});

describe("get_asset_status", () => {
  const withFlag = asset({ raised: [raisedFlag()], status: "WARNING", not_evaluated: [{ flag: "LARGE_MINT_BURN", outcome: "not_evaluated", reason: "r" }] });

  it("relays the raised flags with their stored statements and a fact sheet path", () => {
    const out = projectAssetStatus(statusFile([withFlag]), "AAA");
    expect(out.found).toBe(true);
    if (!out.found) return;
    expect(out.assets).toEqual([
      {
        code: "AAA", issuer: withFlag.issuer, status: "WARNING", as_of: "2026-10-08", rules_version: "flags-test",
        raised_flags: [{ code: "SUPPLY_MISMATCH", severity: "WARNING", statement: raisedFlag().statement, as_of: "2026-10-08" }],
        not_evaluated_count: 1, fact_sheet: "/en/assets/AAA",
      },
    ]);
  });

  it("projects a fixed subset: unknown extra fields and evidence never appear", () => {
    const noisy = { ...withFlag, secret_extra: "x", raised: [{ ...raisedFlag(), brand_new_field: "y" }] };
    const status = { ...statusFile([noisy]), feed_schema: 2, new_top_field: 1 };
    const text = JSON.stringify(projectAssetStatus(status as never, "AAA"));
    expect(text).not.toMatch(/secret_extra|brand_new_field|feed_schema|new_top_field|evidence|chain_check/);
  });

  it("returns found:false and points at check_asset for an unknown code", () => {
    const out = projectAssetStatus(statusFile([withFlag]), "ZZZ");
    expect(out).toMatchObject({ found: false });
    expect((out as { note: string }).note).toMatch(/check_asset/);
  });

  it("hints at case when only the case differs", () => {
    const out = projectAssetStatus(statusFile([withFlag]), "aaa") as { note: string };
    expect(out.note).toMatch(/case-sensitive.*AAA/);
  });

  it("filters by issuer and says so when the issuer does not match", () => {
    const status = statusFile([withFlag, asset({ asset: `AAA:${OTHER}`, issuer: OTHER, status: "OK" })]);
    const hit = projectAssetStatus(status, "AAA", OTHER);
    expect(hit.found && hit.assets.map((a) => a.issuer)).toEqual([OTHER]);
    expect(hit.found && hit.assets[0].fact_sheet).toBeNull(); // the code is not unique, so no fact sheet page exists
    const miss = projectAssetStatus(statusFile([withFlag]), "AAA", OTHER) as { found: boolean; note: string };
    expect(miss.found).toBe(false);
    expect(miss.note).toMatch(/not for that issuer/);
  });

  it("returns at most 5 matches", () => {
    const many = Array.from({ length: 7 }, (_, i) => asset({ asset: `AAA:${i}`, issuer: `G${i}` }));
    const out = projectAssetStatus(statusFile(many), "AAA");
    expect(out.found && out.assets.length).toBe(5);
  });

  it("run(): validates inputs", async () => {
    expect(await run("get_asset_status", { asset_code: "bad code!" })).toHaveProperty("error");
    expect(await run("get_asset_status", { asset_code: "USTRY", issuer: "GNOTANACCOUNT" })).toHaveProperty("error");
  });

  it("run(): unknown code reads the real status file and falls back to check_asset", async () => {
    const out = await run("get_asset_status", { asset_code: "NOPE" });
    expect(out.found).toBe(false);
    expect(out.note).toMatch(/check_asset/);
  });

  it("run(): relays a real asset's stored status and flags", async () => {
    const out = await run("get_asset_status", { asset_code: "gBENJI" });
    expect(out.found).toBe(true);
    const a = out.assets[0];
    expect(a.status).toBe("WARNING");
    expect(a.raised_flags[0]).toMatchObject({ code: "NO_PUBLIC_DOCS" });
    expect(a.raised_flags[0].statement).toMatch(/^No issuer document or regulatory filing/);
    expect(a.fact_sheet).toBe("/en/assets/gBENJI");
    expect(Object.keys(a).sort()).toEqual(["as_of", "code", "fact_sheet", "issuer", "not_evaluated_count", "raised_flags", "rules_version", "status"]);
  });
});

describe("get_verified_claims", () => {
  it("returns the projection only, with the untrusted-data note", () => {
    const out = projectClaims([claim(1, { source_class: "regulatory_filing", field_source: "operator-reviewed", page: null })], universe, "AAA");
    expect(out.note).toMatch(/untrusted/i);
    expect(out.claims).toEqual([
      {
        field: "custodian", value: "Bank", as_of: null, quote: "The custodian is Bank 1.", source_url: "https://a.example/doc.pdf", page_or_section: null,
        snapshot_sha256: "ab".repeat(32), source_class: "regulatory_filing", field_source: "operator-reviewed", about: "asset",
      },
    ]);
    expect(JSON.stringify(out)).not.toMatch(/text_sha256|doc_key|prompt_version|extractor|"model"/);
  });

  it("readClaims drops anything not marked verified and tolerates a missing file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tool-claims-"));
    try {
      expect(readClaims(dir)).toEqual([]);
      fs.writeFileSync(path.join(dir, "claims.json"), JSON.stringify([claim(1), { ...claim(2), verified: false }, { ...claim(3), quote: undefined }]));
      expect(readClaims(dir).map((c) => c.id)).toEqual(["c1"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("caps at 10 claims and says more exist", () => {
    const out = projectClaims(Array.from({ length: 12 }, (_, i) => claim(i)), universe, "AAA");
    expect(out.returned).toBe(MAX_CLAIMS);
    expect(out.total_matching).toBe(12);
    expect(out.claims.length).toBe(10);
    expect(out).toMatchObject({ truncated: true });
  });

  it("marks truncated quotes and never cuts silently", () => {
    const long = "x".repeat(MAX_QUOTE_CHARS + 50);
    const out = projectClaims([claim(1, { quote: long }), claim(2, { quote: "y".repeat(MAX_QUOTE_CHARS) })], universe, "AAA");
    expect(out.claims[0].quote.length).toBe(MAX_QUOTE_CHARS);
    expect(out.claims[0]).toMatchObject({ quote_truncated: true });
    expect(long.startsWith(out.claims[0].quote)).toBe(true);
    expect(out.claims[1].quote.length).toBe(MAX_QUOTE_CHARS);
    expect("quote_truncated" in out.claims[1]).toBe(false);
  });

  it("filters by field and by issuer", () => {
    const claims = [claim(1), claim(2, { field: "auditor" }), claim(3, { asset: `AAA:${OTHER}` })];
    expect(projectClaims(claims, universe, "AAA", undefined, "auditor").claims.map((c) => c.field)).toEqual(["auditor"]);
    expect(projectClaims(claims, universe, "AAA", OTHER).returned).toBe(1);
    expect(projectClaims(claims, universe, "ZZZ").hint).toMatch(/No verified claims/);
  });

  it("adds issuer-level claims only when the asset's official domain matches, after the asset's own", () => {
    const org = claim(9, { asset: "ISSUER:a.example", field: "auditor" });
    const elsewhere = claim(8, { asset: "ISSUER:other.example" });
    const out = projectClaims([org, claim(1), elsewhere], universe, "AAA");
    expect(out.claims.map((c) => c.about)).toEqual(["asset", "issuer"]);
  });

  it("run(): validates inputs and the field enum", async () => {
    expect(await run("get_verified_claims", { asset_code: "no spaces" })).toHaveProperty("error");
    expect(await run("get_verified_claims", { asset_code: "USDY", issuer: "G123" })).toHaveProperty("error");
    expect(await run("get_verified_claims", { asset_code: "USDY", field: "price" })).toHaveProperty("error");
    expect((tool("get_verified_claims").parameters as any).properties.field.enum).toEqual([...FIELD_NAMES]);
  });

  it("run(): reads the real claims file; USDY has more than 10, so it is capped", async () => {
    const out = await run("get_verified_claims", { asset_code: "USDY" });
    expect(out.note).toMatch(/untrusted/i);
    expect(out.total_matching).toBeGreaterThan(10);
    expect(out.claims.length).toBe(10);
    for (const c of out.claims) {
      expect(c.quote.length).toBeLessThanOrEqual(MAX_QUOTE_CHARS);
      expect(["issuer", "regulatory_filing", "issuer_toml"]).toContain(c.source_class);
    }
    const custodians = await run("get_verified_claims", { asset_code: "USDY", field: "custodian" });
    expect(custodians.claims.every((c: any) => c.field === "custodian")).toBe(true);
  });

  it("run(): unknown asset has no claims", async () => {
    const out = await run("get_verified_claims", { asset_code: "NOPE" });
    expect(out.claims).toEqual([]);
  });
});

describe("tool result sizes (real data)", () => {
  it("stays small", async () => {
    const sizes = {
      list_assets: bytes(await run("list_assets", {})),
      status_BENJI: bytes(await run("get_asset_status", { asset_code: "BENJI" })),
      status_USTRY: bytes(await run("get_asset_status", { asset_code: "USTRY" })),
      claims_BENJI: bytes(await run("get_verified_claims", { asset_code: "BENJI" })),
      claims_USTRY: bytes(await run("get_verified_claims", { asset_code: "USTRY" })),
      claims_USDY: bytes(await run("get_verified_claims", { asset_code: "USDY" })),
    };
    console.log("tool result bytes", JSON.stringify(sizes));
    expect(sizes.list_assets).toBeLessThan(8000);
    expect(sizes.claims_USDY).toBeLessThan(6000);
  });
});

describe("A5: tool results are escaped at value level", () => {
  const cp = (...c: number[]) => String.fromCodePoint(...c);
  const fake = (result: unknown): Tool => ({ name: "t", description: "", parameters: {}, run: async () => result });
  const dirty = `pay${cp(0x202e)}evil${cp(0xfe0f)} c1${cp(0x85)}x ${cp(0xe0041)}tag\tkept\nkept`;

  it("escapes every string and key in nested results, keeps tab and newline, and leaves other values alone", async () => {
    const [t] = withEscapedResults([fake({ quote: dirty, nested: [{ [`k${cp(0x200b)}`]: dirty }], n: 5, ok: true, none: null })]);
    const out = (await t.run({}, {})) as any;
    const clean = "pay\\u202eevil\\ufe0f c1\\u0085x \\udb40\\udc41tag\tkept\nkept";
    expect(out.quote).toBe(clean);
    expect(out.nested[0]["k\\u200b"]).toBe(clean);
    expect(out).toMatchObject({ n: 5, ok: true, none: null });
    expect(JSON.stringify(out)).not.toMatch(/[\u202e\ufe0f\u0085\u200b]/u);
  });

  it("escapes the message of a thrown error too", async () => {
    const boom: Tool = { name: "t", description: "", parameters: {}, run: async () => { throw new Error(`bad${cp(0x202e)}news${cp(0xfe0f)}`); } };
    const [t] = withEscapedResults([boom]);
    await expect(t.run({}, {})).rejects.toThrow("bad\\u202enews\\ufe0f");
  });

  it("the exported tools are the wrapped ones (every real tool's result goes through the escape)", async () => {
    expect(tools.map((t) => t.name)).toEqual(["get_my_wallet", "fund_my_wallet", "list_assets", "get_asset_status", "get_verified_claims", "get_evidence_bundle", "check_asset"]);
    const out = await run("get_asset_status", { asset_code: "bad code!" });
    expect(out).toHaveProperty("error");
  });

  it("the chat instruction tells the model to leave escapes as shown and to flag an altered quote", () => {
    expect(INSTRUCTIONS).toContain("\\uXXXX");
    expect(INSTRUCTIONS).toMatch(/do not clean them/);
    expect(INSTRUCTIONS).toMatch(/altered by escaping/);
    expect(INSTRUCTIONS).toMatch(/quote the claim verbatim/);
  });
});

describe("A13: check_asset says when a verified issuer is not the pinned one", () => {
  it("names the pinned issuers when the issuer differs", () => {
    const out = pinnedIssuerNote(universe, "AAA", OTHER);
    expect(out).toMatchObject({ pinned_issuer_differs: true, pinned_issuers: [A] });
    expect(out?.note).toContain("not the one pinned in data/assets.csv");
    expect(out?.note).toContain(A);
  });

  it("says nothing when the issuer is pinned or the code has no pinned row", () => {
    expect(pinnedIssuerNote(universe, "AAA", A)).toBeNull();
    expect(pinnedIssuerNote(universe, "ZZZ", A)).toBeNull();
  });
});

describe("get_evidence_bundle", () => {
  const prior = { ...process.env };
  const restore = () => {
    for (const k of Object.keys(process.env)) if (!(k in prior)) delete process.env[k];
    Object.assign(process.env, prior);
  };

  it("is registered, and its description says that it does not pay and returns no evidence", () => {
    const t = tool("get_evidence_bundle");
    expect(t.description).toMatch(/does NOT pay/);
    expect(t.description).toMatch(/USER pays/);
    expect(INSTRUCTIONS).toMatch(/never say you paid/);
  });

  it("answers not available when the paid switch is off, and carries no evidence", async () => {
    delete process.env.X402_ENABLED;
    try {
      const out = await run("get_evidence_bundle", { asset_code: "USTRY" });
      expect(out).toMatchObject({ premium: true, available: false, detail_path: null });
      expect(JSON.stringify(out)).not.toMatch(/quote|snapshot_sha256|check-detail/);
    } finally {
      restore();
    }
  });

  it("when the switch is on, only names the asset and the detail path: still no bundle", async () => {
    Object.assign(process.env, { X402_ENABLED: "true", X402_PAY_TO: A, X402_TESTNET_AMOUNT: "1", PRICING_ENABLED: "false" });
    try {
      const out = await run("get_evidence_bundle", { asset_code: "USTRY" });
      expect(Object.keys(out).sort()).toEqual(["asset_code", "available", "detail_path", "issuer", "note", "premium"]);
      expect(out.premium).toBe(true);
      if (out.available) expect(out.detail_path).toMatch(/^\/api\/check\/detail\?asset_code=USTRY&issuer=G/);
      expect(JSON.stringify(out)).not.toMatch(/"quote"|snapshot_sha256|check-detail/);
    } finally {
      restore();
    }
  });

  it("rejects a bad asset code or issuer", async () => {
    expect((await run("get_evidence_bundle", { asset_code: "bad code" })).error).toMatch(/asset_code/);
    expect((await run("get_evidence_bundle", { asset_code: "USTRY", issuer: "nope" })).error).toMatch(/issuer/);
  });
});
