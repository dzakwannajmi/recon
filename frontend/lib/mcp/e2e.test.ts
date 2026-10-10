/**
 * The three tools through a real MCP client, in both protocol eras (spec 9: M1-M8, M11-M16).
 * In process: the client's fetch is `handleMcp`, so nothing touches the network. The modules that could
 * reach the network are replaced with throwers for the whole file (M12).
 */
import fs from "fs";
import os from "os";
import path from "path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { Keypair } from "@stellar/stellar-sdk";
import { NextRequest } from "next/server";
import { afterAll, describe, expect, it, vi } from "vitest";
import { loadStatus } from "../factsheet/load";
import { FLAG_ORDER } from "../flags/types";
import { ERROR_MESSAGES } from "../gateway/copy";
import type { GatewayData } from "../gateway/data";
import { handleSummary } from "../gateway/handlers";
import { createRateLimiter } from "../gateway/rate-limit";
import { PAY_TO, realData } from "../gateway/testkit";
import { MCP_INTERNAL_ERROR, SERVER_INSTRUCTIONS } from "./copy";
import { handleMcp } from "./http";
import { MAX_FACT_SHEET_BYTES } from "./limits";
import { QUOTE_WITH_INVISIBLES, brokenUniverse, dataWith, harness, issuerKey, manyRaised, twoIssuers, URL_MCP, withInvisibleQuote, withNullStatus, type Harness } from "./testkit";
import { checkSummaryOutputSchema, factSheetOutputSchema, flagListOutputSchema } from "./schemas";

const refuse = vi.hoisted(() => (name: string) => () => {
  throw new Error(`${name} must not be called by the MCP path`);
});
vi.mock("../chain/http", async (orig) => ({ ...(await orig<typeof import("../chain/http")>()), fetchUntrustedText: refuse("fetchUntrustedText"), fetchTrustedJson: refuse("fetchTrustedJson") }));
vi.mock("../feed/reader", async (orig) => ({ ...(await orig<typeof import("../feed/reader")>()), createRpc: refuse("createRpc"), createFeedReader: refuse("createFeedReader") }));

type Era = "legacy" | "modern";
const ERAS: Era[] = ["legacy", "modern"];

type Session = { client: Client; bodies: string[] };

/** Connects a real client in the given era, records every raw response body, runs `fn`, and closes. */
async function withClient<T>(era: Era, h: Harness, fn: (s: Session) => Promise<T>): Promise<T> {
  const client = new Client({ name: "test-client", version: "1.0.0" }, era === "modern" ? { versionNegotiation: { mode: { pin: "2026-07-28" } } } : {});
  const bodies: string[] = [];
  const transport = new StreamableHTTPClientTransport(new URL(URL_MCP), {
    fetch: async (u, init) => {
      const res = await handleMcp(new Request(u, init), h.deps);
      bodies.push(await res.clone().text());
      return res;
    },
  });
  await client.connect(transport);
  try {
    return await fn({ client, bodies });
  } finally {
    await client.close();
  }
}

const call = (c: Client, name: string, args: Record<string, unknown> = {}) => c.callTool({ name, arguments: args });
const textOf = (r: { content?: unknown }) => ((r.content as { type: string; text: string }[])[0]?.text ?? "");

const real = realData();
const status = real.status();
const universe = real.universe();
const GBENJI = status.status.assets.find((a) => a.asset_code === "gBENJI")!;
const USTRY = status.status.assets.find((a) => a.asset_code === "USTRY")!;

const summaryBody = async (query: string, data: GatewayData = real) => {
  const res = await handleSummary(new NextRequest(`http://localhost/api/check?${query}`), { env: {}, data, limiter: createRateLimiter({ perIpPerMin: 1000, globalPerMin: 1000, trustProxy: false }) });
  return { status: res.status, body: await res.json() };
};

describe("M1: tools/list and server info", () => {
  for (const era of ERAS) {
    it(`${era}: three read-only tools with strict schemas`, async () => {
      await withClient(era, harness(), async ({ client }) => {
        const { tools } = await client.listTools();
        expect(tools.map((t) => t.name).sort()).toEqual(["check_asset", "get_fact_sheet", "list_flags"]);
        for (const t of tools) {
          expect(t.annotations, t.name).toEqual({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
          expect(t.inputSchema.additionalProperties, t.name).toBe(false);
          expect(t.outputSchema?.type, t.name).toBe("object");
          expect(t.title && t.description, t.name).toBeTruthy();
        }
        for (const name of ["check_asset", "get_fact_sheet"]) {
          const props = tools.find((t) => t.name === name)!.inputSchema.properties as Record<string, { pattern?: string }>;
          expect(props.asset_code.pattern).toBe("^[A-Za-z0-9]{1,12}$");
          expect(props.issuer.pattern).toBe("^G[A-Z2-7]{55}$");
          expect(tools.find((t) => t.name === name)!.inputSchema.required).toEqual(["asset_code"]);
        }
        expect(client.getServerVersion()).toMatchObject({ name: "recon", title: "Recon", version: "0.1.0" });
        expect(client.getInstructions()).toBe(SERVER_INSTRUCTIONS);
        expect(Object.keys(client.getServerCapabilities() ?? {})).toEqual(["tools"]);
        expect(client.getServerCapabilities()?.tools?.listChanged).toBe(false);
      });
    });
  }
});

describe("M2: check_asset equals GET /api/check", () => {
  for (const era of ERAS) {
    it(`${era}: gBENJI`, async () => {
      await withClient(era, harness(), async ({ client }) => {
        const r = await call(client, "check_asset", { asset_code: "gBENJI" });
        const http = await summaryBody("asset_code=gBENJI");
        expect(r.isError).toBeFalsy();
        expect(r.structuredContent).toEqual(http.body);
        expect(JSON.parse(textOf(r))).toEqual(r.structuredContent);
        const raised = (r.structuredContent as { raised_flags: { statement: string }[] }).raised_flags;
        expect(raised.map((f) => f.statement)).toEqual(GBENJI.raised.map((f) => f.statement));
      });
    });
  }

  it("the same body with an issuer, and paid_detail.available read as a boolean", async () => {
    await withClient("legacy", harness({ env: {} }), async ({ client }) => {
      const r = await call(client, "check_asset", { asset_code: "gBENJI", issuer: GBENJI.issuer });
      expect(r.structuredContent).toEqual((await summaryBody(`asset_code=gBENJI&issuer=${GBENJI.issuer}`)).body);
      expect((r.structuredContent as { paid_detail: { available: boolean } }).paid_detail.available).toBe(false);
    });
  });
});

describe("M3: check_asset errors are tool errors with the /api/check bodies", () => {
  const wrongIssuer = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 9)).publicKey();
  const cases: [string, Record<string, unknown>, string, string][] = [
    ["XYZ", { asset_code: "XYZ" }, "asset_code=XYZ", "unknown_code"],
    ["gbenji", { asset_code: "gbenji" }, "asset_code=gbenji", "unknown_code"],
    ["USDC", { asset_code: "USDC" }, "asset_code=USDC", "stablecoin_out_of_scope"],
    ["wrong issuer", { asset_code: "gBENJI", issuer: wrongIssuer }, `asset_code=gBENJI&issuer=${wrongIssuer}`, "issuer_not_pinned"],
  ];
  for (const era of ERAS) {
    for (const [label, args, query, reason] of cases) {
      it(`${era}: ${label}`, async () => {
        await withClient(era, harness(), async ({ client }) => {
          const r = await call(client, "check_asset", args);
          const http = await summaryBody(query);
          expect(r.isError).toBe(true);
          expect(r.structuredContent).toBeUndefined();
          const body = JSON.parse(textOf(r));
          expect(body).toEqual(http.body);
          expect(body).toMatchObject({ error: "not_tracked", reason });
        });
      });
    }
    it(`${era}: gbenji suggests gBENJI; the wrong issuer lists the tracked one`, async () => {
      await withClient(era, harness(), async ({ client }) => {
        expect(JSON.parse(textOf(await call(client, "check_asset", { asset_code: "gbenji" })))).toMatchObject({ did_you_mean: ["gBENJI"] });
        expect(JSON.parse(textOf(await call(client, "check_asset", { asset_code: "gBENJI", issuer: wrongIssuer })))).toMatchObject({ tracked_issuers: [{ issuer: GBENJI.issuer }] });
      });
    });

    it(`${era}: two tracked issuers without an issuer is ambiguous_asset`, async () => {
      const data = twoIssuers();
      await withClient(era, harness({ data }), async ({ client }) => {
        const r = await call(client, "check_asset", { asset_code: "gBENJI" });
        const http = await summaryBody("asset_code=gBENJI", data);
        expect(r.isError).toBe(true);
        expect(r.structuredContent).toBeUndefined();
        expect(JSON.parse(textOf(r))).toEqual(http.body);
        expect(http.status).toBe(409);
        expect(JSON.parse(textOf(r))).toMatchObject({ error: "ambiguous_asset", message: ERROR_MESSAGES.ambiguous_asset });
      });
    });
  }
});

describe("M4: invalid input is refused by the schema and never reaches the callback", () => {
  const bad = issuerKey(7).slice(0, -1) + (issuerKey(7).endsWith("A") ? "B" : "A");
  const seventeen = Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`k${i}`, i]));
  const cases: [string, Record<string, unknown>][] = [
    ["a dash in the code", { asset_code: "BEN-JI" }],
    ["13 characters", { asset_code: "ABCDEFGHIJKLM" }],
    ["an empty issuer", { asset_code: "gBENJI", issuer: "" }],
    ["a bad checksum", { asset_code: "gBENJI", issuer: bad }],
    ["an unknown key", { asset_code: "gBENJI", extra_key: "x" }],
    ["a number", { asset_code: 5 }],
    ["17 argument elements", { asset_code: "gBENJI", ...seventeen }],
    ["no arguments", {}],
  ];
  for (const era of ERAS) {
    it(`${era}: every case is isError, nothing is logged as a call, and no argument text is logged`, async () => {
      const h = harness();
      await withClient(era, h, async ({ client }) => {
        for (const [label, args] of cases) {
          const r = await call(client, "check_asset", args);
          expect(r.isError, label).toBe(true);
          expect(r.structuredContent, label).toBeUndefined();
        }
        // The element cap, not some other schema error, refuses the 17-element case.
        expect(textOf(await call(client, "check_asset", { asset_code: "gBENJI", ...seventeen }))).toContain("maximum of 16 elements");
        const r = await call(client, "list_flags", { flag: "NOT_A_FLAG" });
        expect(r.isError).toBe(true);
        expect((await call(client, "list_flags", { severity: "LOW" })).isError).toBe(true);
      });
      expect(h.logs.filter((l) => l.event === "mcp_tool_call")).toEqual([]);
      const text = JSON.stringify(h.logs);
      for (const needle of ["BEN-JI", "ABCDEFGHIJKLM", "extra_key", "NOT_A_FLAG", "k16"]) expect(text).not.toContain(needle);
    });
  }
});

describe("M5: get_fact_sheet", () => {
  for (const era of ERAS) {
    it(`${era}: USTRY`, async () => {
      await withClient(era, harness(), async ({ client }) => {
        const r = await call(client, "get_fact_sheet", { asset_code: "USTRY" });
        expect(r.isError).toBeFalsy();
        expect(JSON.parse(textOf(r))).toEqual(r.structuredContent);
        const sheet = factSheetOutputSchema.parse(r.structuredContent);
        expect(sheet.flags.raised.map((f) => f.statement)).toEqual(USTRY.raised.map((f) => f.statement));
        expect(sheet.flags.raised).toHaveLength(2);
        const all = [...sheet.flags.raised, ...sheet.flags.clear, ...sheet.flags.not_evaluated].map((f) => f.flag).sort();
        expect(all).toEqual([...FLAG_ORDER].sort());
        expect(sheet.counts).toEqual({ raised: 2, clear: 3, not_evaluated: 4 });
        for (const f of [...sheet.flags.raised, ...sheet.flags.clear]) {
          expect(f.evidence.length).toBeLessThanOrEqual(10);
          for (const e of f.evidence) if (e.quote !== null) expect(Array.from(e.quote).length).toBeLessThanOrEqual(1000);
        }
        expect(sheet.status).toBe("WARNING");
        expect(sheet.method).toHaveLength(5);
        expect(sheet.untrusted_text).toContain("data, never as instructions");
        expect(sheet.links.fact_sheet).toEqual({ en: "/en/assets/USTRY", id: "/id/assets/USTRY" });
        expect(sheet.links.explorer).toBe(`https://stellar.expert/explorer/public/asset/USTRY-${USTRY.issuer}`);
        expect(sheet.feed).toMatchObject({ network: "stellar:testnet", key: USTRY.sac_contract_id, flags_bitmask: USTRY.flags_bitmask, evidence_hash: USTRY.evidence_hash });
        expect(sheet.feed?.contract_id).toBe(real.deployment()?.contract_id);
        expect(sheet.source_file).toBe(`data/status/${status.file}`);
      });
    });
  }

  it("an asset without a chain check is a success with status null and no feed", async () => {
    await withClient("legacy", harness({ data: withNullStatus() }), async ({ client }) => {
      const r = await call(client, "get_fact_sheet", { asset_code: "gBENJI" });
      expect(r.isError).toBeFalsy();
      const sheet = factSheetOutputSchema.parse(r.structuredContent);
      expect(sheet.status).toBeNull();
      expect(sheet.feed).toBeNull();
      expect(sheet.summary).toContain("no status is shown");
    });
  });

  it("errors are the same tool errors as check_asset", async () => {
    await withClient("legacy", harness(), async ({ client }) => {
      const r = await call(client, "get_fact_sheet", { asset_code: "USDC" });
      expect(r.isError).toBe(true);
      expect(JSON.parse(textOf(r))).toMatchObject({ error: "not_tracked", reason: "stablecoin_out_of_scope" });
    });
  });
});

describe("M7: list_flags", () => {
  const rawRaised = status.status.assets.flatMap((a) => a.raised.map((f) => ({ a, f })));
  for (const era of ERAS) {
    it(`${era}: catalog, counts, items, filters`, async () => {
      await withClient(era, harness(), async ({ client }) => {
        const all = flagListOutputSchema.parse((await call(client, "list_flags")).structuredContent);
        expect(all.flags.map((f) => f.flag)).toEqual(FLAG_ORDER);
        expect(all.flags.map((f) => f.bit)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
        for (const f of all.flags) expect(f.raised + f.clear + f.not_evaluated, f.flag).toBe(status.status.assets.length);
        expect(all.raised.total).toBe(rawRaised.length);
        expect(all.raised.total).toBeGreaterThan(0);
        expect(all.raised.truncated).toBe(false);
        expect(all.raised.items.map((i) => i.statement).sort()).toEqual(rawRaised.map(({ f }) => f.statement).sort());
        expect(all.status_counts).toEqual(status.status.summary);
        expect(all.filters).toEqual({ flag: null, severity: null });
        expect(all.source_file).toBe(`data/status/${status.file}`);

        const one = flagListOutputSchema.parse((await call(client, "list_flags", { flag: "FLAG_CHANGE" })).structuredContent);
        expect(one.raised.items.every((i) => i.flag === "FLAG_CHANGE")).toBe(true);
        expect(one.raised.total).toBe(rawRaised.filter(({ f }) => f.flag === "FLAG_CHANGE").length);
        expect(one.flags).toHaveLength(9); // counts ignore the filters
        expect(one.filters.flag).toBe("FLAG_CHANGE");

        const warn = flagListOutputSchema.parse((await call(client, "list_flags", { severity: "WARNING" })).structuredContent);
        expect(warn.raised.total).toBe(rawRaised.filter(({ f }) => f.effective_severity === "WARNING").length);
        const crit = flagListOutputSchema.parse((await call(client, "list_flags", { severity: "CRITICAL" })).structuredContent);
        expect(crit.raised.total).toBe(rawRaised.filter(({ f }) => f.effective_severity === "CRITICAL").length);
      });
    });

    it(`${era}: a 126-item fixture gives 100 items, total 126, truncated`, async () => {
      await withClient(era, harness({ data: manyRaised() }), async ({ client }) => {
        const out = flagListOutputSchema.parse((await call(client, "list_flags")).structuredContent);
        expect(out.raised.items).toHaveLength(100);
        expect(out.raised.returned).toBe(100);
        expect(out.raised.total).toBe(rawRaised.length + 14 * 9);
        expect(out.raised.truncated).toBe(true);
      });
    });
  }
});

describe("M6 and M12: every asset of every committed status file, both eras, no network", () => {
  const statusDir = path.join(process.cwd(), "..", "data", "status");
  const files = fs.readdirSync(statusDir).filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n));
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  });

  /** Gateway data whose status comes from one committed file (through the real loader and its validation). */
  function dataFor(file: string): GatewayData {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-status-"));
    dirs.push(dir);
    fs.mkdirSync(path.join(dir, "status"));
    fs.copyFileSync(path.join(statusDir, file), path.join(dir, "status", file));
    const loaded = loadStatus(dir);
    return { ...real, status: () => loaded };
  }

  it("there are committed status files", () => {
    expect(files.length).toBeGreaterThanOrEqual(2);
  });

  for (const file of files) {
    it(`${file}: each tool's output passes its strict schema and the client's JSON Schema check`, async () => {
      const data = dataFor(file);
      const loaded = data.status();
      const fetchSpy = vi.fn(() => {
        throw new Error("network");
      });
      vi.stubGlobal("fetch", fetchSpy);
      try {
        for (const era of ERAS) {
          await withClient(era, harness({ data }), async ({ client }) => {
            const flags = await call(client, "list_flags");
            expect(flagListOutputSchema.strict().parse(flags.structuredContent).raised.total).toBeGreaterThanOrEqual(0);
            for (const a of loaded.status.assets) {
              const args = { asset_code: a.asset_code, issuer: a.issuer };
              const summary = await call(client, "check_asset", args);
              const sheet = await call(client, "get_fact_sheet", args);
              expect(summary.isError, a.asset).toBeFalsy();
              expect(sheet.isError, a.asset).toBeFalsy();
              checkSummaryOutputSchema.parse(summary.structuredContent);
              factSheetOutputSchema.parse(sheet.structuredContent);
              expect(Buffer.byteLength(JSON.stringify(sheet.structuredContent)), a.asset).toBeLessThanOrEqual(MAX_FACT_SHEET_BYTES);
              expect(JSON.parse(textOf(sheet))).toEqual(sheet.structuredContent);
            }
          });
        }
        expect(fetchSpy).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    }, 60_000);
  }

  it("the status:null fixture passes too", async () => {
    await withClient("modern", harness({ data: withNullStatus() }), async ({ client }) => {
      const args = { asset_code: "gBENJI" };
      checkSummaryOutputSchema.parse((await call(client, "check_asset", args)).structuredContent);
      factSheetOutputSchema.parse((await call(client, "get_fact_sheet", args)).structuredContent);
      flagListOutputSchema.parse((await call(client, "list_flags")).structuredContent);
    });
  });
});

describe("M8: both eras give the same structured content", () => {
  it("check_asset, get_fact_sheet and list_flags", async () => {
    const calls: [string, Record<string, unknown>][] = [
      ["check_asset", { asset_code: "gBENJI" }],
      ["check_asset", { asset_code: "USTRY" }],
      ["get_fact_sheet", { asset_code: "USTRY" }],
      ["get_fact_sheet", { asset_code: "BENJI" }],
      ["list_flags", {}],
      ["list_flags", { flag: "FLAG_CHANGE", severity: "WARNING" }],
    ];
    const results = new Map<Era, unknown[]>();
    for (const era of ERAS) {
      results.set(
        era,
        await withClient(era, harness(), async ({ client }) => {
          const out: unknown[] = [];
          for (const [name, args] of calls) out.push((await call(client, name, args)).structuredContent);
          return out;
        }),
      );
    }
    expect(results.get("legacy")).toEqual(results.get("modern"));
    expect((results.get("legacy") as unknown[]).every((r) => r !== undefined)).toBe(true);
  });
});

describe("M11: invisible characters never travel as raw bytes", () => {
  const BAD = [String.fromCodePoint(0x202e), String.fromCodePoint(0x2028), String.fromCodePoint(0xe0041)];
  for (const era of ERAS) {
    it(`${era}: the wire has none, structuredContent keeps them, the text block shows them escaped`, async () => {
      await withClient(era, harness({ data: withInvisibleQuote() }), async ({ client, bodies }) => {
        const r = await call(client, "get_fact_sheet", { asset_code: "USTRY" });
        expect(r.isError).toBeFalsy();
        const quotes = factSheetOutputSchema.parse(r.structuredContent).flags.raised.flatMap((f) => f.evidence.map((e) => e.quote));
        expect(quotes).toContain(QUOTE_WITH_INVISIBLES);
        const text = textOf(r);
        for (const ch of BAD) expect(text.includes(ch)).toBe(false);
        for (const escape of ["\\u202e", "\\u2028", "\\udb40\\udc41"]) expect(text).toContain(escape);
        const raw = bodies.join("\n");
        for (const ch of BAD) expect(raw.includes(ch)).toBe(false);
        expect(raw).toContain("reversed");
      });
    });
  }
});

describe("M13: no amount and no secret in any output (golden rules 7 and 8)", () => {
  const SENTINEL = "918273645546";
  const SECRET = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 3)).secret();
  const runs: [string, Record<string, string>, boolean, string][] = [
    ["a valid configuration", { X402_ENABLED: "true", X402_PAY_TO: PAY_TO, X402_TESTNET_AMOUNT: SENTINEL }, true, SENTINEL],
    ["a secret key as pay-to", { X402_ENABLED: "true", X402_PAY_TO: SECRET, X402_TESTNET_AMOUNT: SENTINEL }, false, SECRET],
  ];
  for (const [label, env, available, needle] of runs) {
    it(`${label}: available is ${available}; no body holds the ${available ? "amount" : "secret"}`, async () => {
      for (const era of ERAS) {
        await withClient(era, harness({ env }), async ({ client, bodies }) => {
          for (const a of status.status.assets) {
            const args = { asset_code: a.asset_code, issuer: a.issuer };
            const r = await call(client, "check_asset", args);
            expect((r.structuredContent as { paid_detail: { available: boolean } }).paid_detail.available, a.asset).toBe(available);
            await call(client, "get_fact_sheet", args);
          }
          await call(client, "list_flags");
          const raw = bodies.join("\n");
          expect(raw).not.toContain(needle);
          expect(raw).not.toContain(SENTINEL);
          expect(raw).not.toContain(SECRET);
          expect(raw).not.toContain(PAY_TO);
        });
      }
    });
  }
});

describe("M14: an internal error is a fixed tool error", () => {
  for (const era of ERAS) {
    it(`${era}: a loader that throws gives isError with the fixed sentence and no file path`, async () => {
      const h = harness({ data: brokenUniverse() });
      await withClient(era, h, async ({ client }) => {
        for (const tool of ["check_asset", "get_fact_sheet"]) {
          const r = await call(client, tool, { asset_code: "gBENJI" });
          expect(r.isError).toBe(true);
          expect(r.structuredContent).toBeUndefined();
          expect(JSON.parse(textOf(r))).toEqual({ error: "internal_error", message: MCP_INTERNAL_ERROR });
          expect(textOf(r)).not.toContain("assets.csv");
          expect(textOf(r)).not.toContain("/secret/path");
        }
      });
      const internal = h.logs.filter((l) => l.event === "mcp_internal_error");
      expect(internal).toHaveLength(2);
      expect(h.logs.filter((l) => l.event === "mcp_tool_call").map((l) => (l as { outcome: string }).outcome)).toEqual(["internal_error", "internal_error"]);
    });
  }
});

describe("M15: logging", () => {
  it("one mcp_tool_call line per call: tool, outcome, validated asset, no quote text", async () => {
    const h = harness({ data: withInvisibleQuote() });
    await withClient("legacy", h, async ({ client }) => {
      await call(client, "check_asset", { asset_code: "gBENJI" });
      await call(client, "get_fact_sheet", { asset_code: "USTRY", issuer: USTRY.issuer });
      await call(client, "list_flags");
      await call(client, "check_asset", { asset_code: "USDC" });
      await call(client, "check_asset", { asset_code: "gBENJI", extra: 1 });
    });
    const lines = h.logs.filter((l) => l.event === "mcp_tool_call") as { tool: string; outcome: string; asset?: string; ms: number; at: string }[];
    expect(lines.map((l) => [l.tool, l.outcome, l.asset])).toEqual([
      ["check_asset", "ok", "gBENJI"],
      ["get_fact_sheet", "ok", `USTRY:${USTRY.issuer}`],
      ["list_flags", "ok", undefined],
      ["check_asset", "not_tracked", "USDC"],
    ]);
    for (const l of lines) {
      expect(typeof l.ms).toBe("number");
      expect(l.at).toBe("2026-10-10T12:00:00.000Z");
    }
    const text = JSON.stringify(h.logs);
    expect(text).not.toContain("reversed");
    expect(text).not.toContain("source_url");
  });

  it("a rejected Origin logs the reason only", async () => {
    const h = harness();
    const res = await handleMcp(new Request(URL_MCP, { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: "{}" }), h.deps);
    expect(res.status).toBe(403);
    expect(h.logs).toEqual([{ event: "mcp_rejected", at: "2026-10-10T12:00:00.000Z", reason: "origin" }]);
    expect(JSON.stringify(h.logs)).not.toContain("evil");
  });
});

describe("M16: copy and version", () => {
  it("lib/mcp/copy.ts has no grade words", () => {
    const text = fs.readFileSync(path.join(process.cwd(), "lib/mcp/copy.ts"), "utf8").toLowerCase();
    for (const word of ["fraud", "rating", "score", "grade"]) expect(text, word).not.toContain(word);
  });

  it("the server version equals package.json", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as { version: string };
    return withClient("legacy", harness(), async ({ client }) => {
      expect(client.getServerVersion()?.version).toBe(pkg.version);
    });
  });

  it("the committed universe and status are the ones the fixtures expect", () => {
    expect(universe.length).toBeGreaterThan(20);
    expect(dataWith((a) => a).status().status.assets).toHaveLength(status.status.assets.length);
  });
});
