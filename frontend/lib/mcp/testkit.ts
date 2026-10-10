/**
 * Test helpers for the MCP endpoint: deps over the committed `data/`, status fixtures, and a raw request helper.
 * No network. Test support only; nothing in the app imports this file.
 */
import { Keypair } from "@stellar/stellar-sdk";
import type { LoadedAsset, LoadedStatus } from "../factsheet/load";
import { FLAG_ORDER } from "../flags/types";
import type { GatewayData } from "../gateway/data";
import { createRateLimiter } from "../gateway/rate-limit";
import { realData } from "../gateway/testkit";
import type { HttpDeps } from "./http";
import type { McpLogLine } from "./log";
import { createHandler } from "./server";
import type { ToolDeps } from "./tools";

export const URL_MCP = "http://mcp.test/api/mcp";
export const NOW = new Date("2026-10-10T12:00:00.000Z");

export type Harness = {
  deps: HttpDeps;
  toolDeps: ToolDeps;
  logs: McpLogLine[];
  /** How many times the library handler was asked for (0 when the wrapper refused every request). */
  mcpCalls: () => number;
};

export function harness(over: { env?: Record<string, string | undefined>; data?: GatewayData; globalPerMin?: number } = {}): Harness {
  const logs: McpLogLine[] = [];
  const env = over.env ?? {};
  const data = over.data ?? realData();
  const log = (l: McpLogLine) => void logs.push(l);
  const now = () => NOW;
  const toolDeps: ToolDeps = { env, data, log, now };
  let handler: ReturnType<typeof createHandler> | null = null;
  let calls = 0;
  const deps: HttpDeps = {
    env,
    limiter: createRateLimiter({ perIpPerMin: 100_000, globalPerMin: over.globalPerMin ?? 100_000, trustProxy: false }),
    log,
    now,
    mcp: () => {
      calls++;
      return (handler ??= createHandler(toolDeps));
    },
  };
  return { deps, toolDeps, logs, mcpCalls: () => calls };
}

/** A POST with a JSON body. */
export function post(body: unknown, headers: Record<string, string> = {}, url = URL_MCP): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

// ---------------------------------------------------------------- status fixtures

const withStatus = (data: GatewayData, status: LoadedStatus): GatewayData => ({ ...data, status: () => status });

export const issuerKey = (n: number) => Keypair.fromRawEd25519Seed(Buffer.alloc(32, n)).publicKey();

/** The committed data with a changed status file. */
export function dataWith(change: (assets: LoadedAsset[]) => LoadedAsset[]): GatewayData {
  const data = realData();
  const loaded = data.status();
  return withStatus(data, { file: loaded.file, status: { ...loaded.status, assets: change(loaded.status.assets) } });
}

/** gBENJI twice: a second tracked issuer for the same code. */
export const twoIssuers = () =>
  dataWith((assets) => {
    const g = assets.find((a) => a.asset_code === "gBENJI") as LoadedAsset;
    return [...assets, { ...g, asset: `gBENJI-${issuerKey(5)}`, issuer: issuerKey(5) }];
  });

/** gBENJI without a chain check. */
export const withNullStatus = () =>
  dataWith((assets) => assets.map((a) => (a.asset_code === "gBENJI" ? { ...a, status: null, status_code: null, checked_at: null } : a)));

export const TAG_CHAR = String.fromCodePoint(0xe0041);
export const QUOTE_WITH_INVISIBLES = `before ${String.fromCodePoint(0x202e)}reversed${String.fromCodePoint(0x2028)}line ${TAG_CHAR}tag after`;

/** USTRY with one extra document evidence whose quote holds invisible characters. */
export const withInvisibleQuote = () =>
  dataWith((assets) =>
    assets.map((a) => {
      if (a.asset_code !== "USTRY" || a.raised.length === 0) return a;
      const [first, ...rest] = a.raised;
      const evidence = [...first.evidence, { kind: "source_fact" as const, ref: "x", source_url: "https://example.com/doc.pdf", snapshot_sha256: "ab".repeat(32), quote: QUOTE_WITH_INVISIBLES, where: "page 1" }];
      return { ...a, raised: [{ ...first, evidence }, ...rest] };
    }),
  );

/** Fourteen copies of an asset with all 9 flags raised: 126 raised items. */
export const manyRaised = () =>
  dataWith((assets) => {
    const template = assets.find((a) => a.asset_code === "gBENJI") as LoadedAsset;
    const raised = FLAG_ORDER.map((flag) => ({
      ...(template.raised[0] ?? { flag, outcome: "raised", severity: "WARNING", effective_severity: "WARNING", review: "not_needed", statement: "x", as_of: "2026-10-09", evidence: [] }),
      flag,
    })) as LoadedAsset["raised"];
    const copies = Array.from({ length: 14 }, (_, i) => ({ ...template, asset: `SYN${i}-${issuerKey(20 + i)}`, asset_code: `SYN${i}`, issuer: issuerKey(20 + i), raised, clear: [], not_evaluated: [] }));
    return [...assets, ...copies];
  });

export const brokenUniverse = (): GatewayData => ({
  ...realData(),
  universe: () => {
    throw new Error("The asset universe is empty or missing (data/assets.csv at /secret/path)");
  },
});
