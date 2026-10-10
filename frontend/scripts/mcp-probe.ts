/**
 * Probe client for the MCP endpoint (spec 10.1), using the official client in both protocol eras.
 *
 *   npm run mcp:probe -- [--url URL] [--era legacy|modern|both] [--out DIR]
 *
 * Read-only calls to one endpoint. No .env file is loaded and no secret is held. With --out it writes
 * DIR/probe-<era>.json with every exchange (request, response, a few headers). Exit code 0 when every
 * expectation holds, 1 otherwise.
 */
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { USAGE, parseProbeArgs, recordingFetch, type Era, type Exchange } from "../lib/mcp/probe";

const CLIENT_NAME = "@modelcontextprotocol/client 2.3.1";

type StepResult = { n: number; label: string; ok: boolean; detail: string };
type ToolResult = { isError?: boolean; content?: unknown; structuredContent?: unknown };

const textOf = (r: ToolResult): string => ((r.content as { text?: string }[] | undefined)?.[0]?.text ?? "");
const bodyOf = (r: ToolResult): Record<string, unknown> => {
  try {
    return JSON.parse(textOf(r)) as Record<string, unknown>;
  } catch {
    return {};
  }
};
/** A successful result carries the same JSON in its text block and in structuredContent. */
const textMatchesStructured = (r: ToolResult) => r.structuredContent !== undefined && isDeepStrictEqual(bodyOf(r), r.structuredContent);

async function runEra(era: Era, url: string): Promise<{ steps: StepResult[]; exchanges: Exchange[]; startedAt: string; finishedAt: string }> {
  const exchanges: Exchange[] = [];
  const steps: StepResult[] = [];
  const startedAt = new Date().toISOString();
  const record = (label: string, ok: boolean, detail: string) => {
    const n = steps.length + 1;
    steps.push({ n, label, ok, detail });
    console.log(`[${era}] ${n}. ${label}: ${detail} ${ok ? "OK" : "FAIL"}`);
  };
  const attempt = async (label: string, fn: () => Promise<{ ok: boolean; detail: string }>) => {
    try {
      const r = await fn();
      record(label, r.ok, r.detail);
    } catch (e) {
      record(label, false, `threw ${(e instanceof Error ? e.message : "an error").slice(0, 120)}`);
    }
  };

  const client = new Client({ name: "mcp-probe", version: "1.0.0" }, era === "modern" ? { versionNegotiation: { mode: { pin: "2026-07-28" } } } : {});
  const transport = new StreamableHTTPClientTransport(new URL(url), { fetch: recordingFetch(fetch, exchanges) });
  const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<ToolResult>;

  let connected = false;
  await attempt("connect", async () => {
    await client.connect(transport);
    connected = true;
    const v = client.getServerVersion();
    return { ok: v?.name === "recon", detail: `server ${v?.name ?? "?"} ${v?.version ?? "?"}` };
  });

  if (connected) {
    await attempt("tools/list", async () => {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name).sort();
      return { ok: isDeepStrictEqual(names, ["check_asset", "get_fact_sheet", "list_flags"]), detail: names.join(", ") };
    });
    await attempt("check_asset gBENJI", async () => {
      const r = await call("check_asset", { asset_code: "gBENJI" });
      const b = bodyOf(r);
      return { ok: !r.isError && typeof b.status === "string" && textMatchesStructured(r), detail: `status ${String(b.status)}` };
    });
    await attempt("check_asset USTRY", async () => {
      const r = await call("check_asset", { asset_code: "USTRY" });
      const b = bodyOf(r);
      const codes = ((b.raised_flags as { code: string }[] | undefined) ?? []).map((f) => f.code);
      return { ok: !r.isError && typeof b.status === "string" && textMatchesStructured(r), detail: `status ${String(b.status)}, raised ${codes.join(",") || "none"}` };
    });
    await attempt("get_fact_sheet USTRY", async () => {
      const r = await call("get_fact_sheet", { asset_code: "USTRY" });
      const b = bodyOf(r);
      const c = b.counts as { raised: number; clear: number; not_evaluated: number } | undefined;
      return { ok: !r.isError && b.schema === "fact-sheet/1" && c !== undefined && c.raised + c.clear + c.not_evaluated === 9 && textMatchesStructured(r), detail: c ? `raised ${c.raised}, clear ${c.clear}, not evaluated ${c.not_evaluated}` : "no counts" };
    });
    await attempt("list_flags", async () => {
      const r = await call("list_flags", {});
      const b = bodyOf(r);
      const total = (b.raised as { total?: number } | undefined)?.total;
      return { ok: !r.isError && b.schema === "flag-list/1" && typeof total === "number" && textMatchesStructured(r), detail: `raised total ${String(total)}` };
    });
    await attempt("list_flags FLAG_CHANGE", async () => {
      const r = await call("list_flags", { flag: "FLAG_CHANGE" });
      const b = bodyOf(r);
      const raised = b.raised as { total?: number; items?: { flag: string }[] } | undefined;
      const only = (raised?.items ?? []).every((i) => i.flag === "FLAG_CHANGE");
      return { ok: !r.isError && only && textMatchesStructured(r), detail: `raised total ${String(raised?.total)}` };
    });
    await attempt("check_asset USDC (out of scope)", async () => {
      const r = await call("check_asset", { asset_code: "USDC" });
      const b = bodyOf(r);
      return { ok: r.isError === true && b.reason === "stablecoin_out_of_scope" && r.structuredContent === undefined, detail: `isError ${String(r.isError)}, ${String(b.reason)}` };
    });
    await attempt("check_asset gbenji (wrong case)", async () => {
      const r = await call("check_asset", { asset_code: "gbenji" });
      const b = bodyOf(r);
      return { ok: r.isError === true && isDeepStrictEqual(b.did_you_mean, ["gBENJI"]), detail: `isError ${String(r.isError)}, did_you_mean ${JSON.stringify(b.did_you_mean)}` };
    });
    await attempt("check_asset with a bad issuer", async () => {
      const r = await call("check_asset", { asset_code: "BENJI", issuer: "GABC" });
      return { ok: r.isError === true, detail: `isError ${String(r.isError)} (input validation)` };
    });
    await attempt("unknown tool delete_asset", async () => {
      // Passes only for the JSON-RPC error -32602 (tool not found). A result, a 429, a 500, or a timeout fails.
      try {
        const r = await call("delete_asset", {});
        return { ok: false, detail: `expected protocol error -32602, got a result (isError ${String(r.isError)})` };
      } catch (e) {
        const code = (e as { code?: unknown }).code;
        return { ok: code === -32602, detail: `protocol error code ${typeof code === "number" || typeof code === "string" ? String(code) : "none"}` };
      }
    });
    await client.close().catch(() => undefined);
  }

  return { steps, exchanges, startedAt, finishedAt: new Date().toISOString() };
}

async function main() {
  let args;
  try {
    args = parseProbeArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`${(e as Error).message}\n\n${USAGE}`);
    process.exit(1);
  }
  if (args.help) {
    console.log(USAGE);
    return;
  }
  console.log(`Probing ${args.url} (${args.eras.join(", ")})`);
  let allOk = true;
  for (const era of args.eras) {
    const run = await runEra(era, args.url);
    const ok = run.steps.length > 0 && run.steps.every((s) => s.ok);
    allOk &&= ok;
    console.log(`[${era}] ${run.steps.filter((s) => s.ok).length}/${run.steps.length} steps passed, ${run.exchanges.length} exchanges`);
    if (args.out) {
      fs.mkdirSync(args.out, { recursive: true });
      const file = path.join(args.out, `probe-${era}.json`);
      fs.writeFileSync(
        file,
        `${JSON.stringify({ client: CLIENT_NAME, era, url: args.url, started_at: run.startedAt, finished_at: run.finishedAt, node: process.version, steps: run.steps, exchanges: run.exchanges }, null, 2)}\n`,
      );
      console.log(`[${era}] wrote ${file}`);
    }
  }
  process.exit(allOk ? 0 : 1);
}

void main();
