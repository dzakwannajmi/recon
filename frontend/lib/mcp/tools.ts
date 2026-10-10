/**
 * The three tools as plain functions: `(args, deps) -> CallToolResult` (spec 4). They read stored files only
 * (golden rules 1, 8, 11): no LLM, no key, no network. They never throw: anything unexpected is logged and
 * answered with the fixed `internal_error` result, so library error text never reaches the caller.
 * One log line per call: tool, outcome, validated asset, milliseconds. Never the arguments as sent.
 */
import type { CallToolResult } from "@modelcontextprotocol/server";
import type { UniverseAsset } from "../chain/universe";
import type { LoadedAsset, LoadedStatus } from "../factsheet/load";
import type { FlagName, Severity } from "../flags/types";
import { ERROR_MESSAGES } from "../gateway/copy";
import type { GatewayData } from "../gateway/data";
import { toJsonText } from "../gateway/json";
import { paymentConfig, type Env } from "../gateway/payment-config";
import { resolutionErrorBody, resolveAsset, validateQuery } from "../gateway/resolve";
import { buildSummary } from "../gateway/summary";
import { MCP_INTERNAL_ERROR } from "./copy";
import { buildFactSheet } from "./factsheet";
import { buildFlagList } from "./flags";
import { shortMessage, type McpLogger, type McpOutcome } from "./log";

export type ToolDeps = {
  /** Read only for `paymentConfig(env).ok`, as a boolean. */
  env: Env;
  data: GatewayData;
  log: McpLogger;
  now: () => Date;
};

type AssetArgs = { asset_code: string; issuer?: string | undefined };
type Found = { asset: LoadedAsset; row: UniverseAsset | null; codeIsUnique: boolean; loaded: LoadedStatus };

const okResult = (body: object): CallToolResult => ({
  content: [{ type: "text", text: toJsonText(body) }],
  structuredContent: body as Record<string, unknown>,
});

const errorResult = (body: object): CallToolResult => ({
  content: [{ type: "text", text: toJsonText(body) }],
  isError: true,
});

/** Runs one tool call with its single log line. `fn` returns the result and its outcome; a throw becomes `internal_error`. */
function guarded(
  tool: string,
  deps: ToolDeps,
  fn: (note: (asset: string) => void) => { result: CallToolResult; outcome: McpOutcome },
): CallToolResult {
  const started = performance.now();
  let outcome: McpOutcome = "internal_error";
  let asset: string | undefined;
  let result: CallToolResult;
  try {
    const r = fn((a) => {
      asset = a;
    });
    result = r.result;
    outcome = r.outcome;
  } catch (e) {
    outcome = "internal_error";
    safely(() => deps.log({ event: "mcp_internal_error", at: deps.now().toISOString(), where: tool, message: shortMessage(e) }));
    result = errorResult({ error: "internal_error", message: MCP_INTERNAL_ERROR });
  }
  safely(() =>
    deps.log({
      event: "mcp_tool_call",
      at: deps.now().toISOString(),
      tool,
      outcome,
      ...(asset !== undefined ? { asset } : {}),
      ms: Math.round(performance.now() - started),
    }),
  );
  return result;
}

/** A logger that fails must not fail the call. */
function safely(fn: () => void) {
  try {
    fn();
  } catch {
    // ignore
  }
}

/** Validates and resolves the asset, then builds the body for a found one. */
function assetTool(tool: string, args: AssetArgs, deps: ToolDeps, build: (found: Found) => object): CallToolResult {
  return guarded(tool, deps, (note) => {
    const query = validateQuery(args);
    if (!query) return { result: errorResult({ error: "invalid_request", message: ERROR_MESSAGES.invalid_request }), outcome: "invalid_request" };
    note(query.issuer === undefined ? query.asset_code : `${query.asset_code}:${query.issuer}`);
    const loaded = deps.data.status();
    const universe = deps.data.universe();
    const r = resolveAsset(query, loaded.status, universe);
    if (r.kind !== "found") {
      const body = resolutionErrorBody(r);
      return { result: errorResult({ error: body.error, message: ERROR_MESSAGES[body.error], ...body.extras }), outcome: body.error };
    }
    const result = okResult(build({ asset: r.asset, row: r.row, codeIsUnique: r.codeIsUnique, loaded }));
    return { result, outcome: "ok" };
  });
}

export function runCheckAsset(args: AssetArgs, deps: ToolDeps): CallToolResult {
  return assetTool("check_asset", args, deps, ({ asset, row, codeIsUnique, loaded }) =>
    buildSummary({
      asset,
      row,
      codeIsUnique,
      status: loaded,
      deployment: deps.data.deployment(),
      paidAvailable: paymentConfig(deps.env).ok,
    }),
  );
}

export function runFactSheet(args: AssetArgs, deps: ToolDeps): CallToolResult {
  return assetTool("get_fact_sheet", args, deps, ({ asset, row, codeIsUnique, loaded }) =>
    buildFactSheet({ asset, row, codeIsUnique, status: loaded, deployment: deps.data.deployment() }),
  );
}

export function runListFlags(args: { flag?: FlagName | undefined; severity?: Severity | undefined }, deps: ToolDeps): CallToolResult {
  return guarded("list_flags", deps, () => {
    const status = deps.data.status();
    return { result: okResult(buildFlagList({ status, filters: { flag: args.flag, severity: args.severity } })), outcome: "ok" };
  });
}
