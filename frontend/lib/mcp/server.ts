/**
 * The MCP server: three read-only tools, no resources, prompts, logging, completions, tasks, or sampling (spec 3).
 * The factory builds a fresh `McpServer` for every HTTP request, as the stateless handler expects.
 */
import { McpServer, createMcpHandler, type McpHttpHandler } from "@modelcontextprotocol/server";
import { SERVER_INSTRUCTIONS, TOOL_COPY } from "./copy";
import { MAX_BODY_BYTES, MAX_TOOL_INPUT_ELEMENTS, SERVER_INFO } from "./limits";
import { shortMessage } from "./log";
import { assetInputSchema, checkSummaryOutputSchema, factSheetOutputSchema, flagListOutputSchema, listFlagsInputSchema } from "./schemas";
import { runCheckAsset, runFactSheet, runListFlags, type ToolDeps } from "./tools";

const ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

export function createServerFactory(deps: ToolDeps): () => McpServer {
  return () => {
    const server = new McpServer(
      { ...SERVER_INFO },
      { instructions: SERVER_INSTRUCTIONS, maxToolInputElements: MAX_TOOL_INPUT_ELEMENTS },
    );
    server.registerTool(
      "check_asset",
      { ...TOOL_COPY.check_asset, inputSchema: assetInputSchema, outputSchema: checkSummaryOutputSchema, annotations: ANNOTATIONS },
      (args) => runCheckAsset(args, deps),
    );
    server.registerTool(
      "get_fact_sheet",
      { ...TOOL_COPY.get_fact_sheet, inputSchema: assetInputSchema, outputSchema: factSheetOutputSchema, annotations: ANNOTATIONS },
      (args) => runFactSheet(args, deps),
    );
    server.registerTool(
      "list_flags",
      { ...TOOL_COPY.list_flags, inputSchema: listFlagsInputSchema, outputSchema: flagListOutputSchema, annotations: ANNOTATIONS },
      (args) => runListFlags(args, deps),
    );
    return server;
  };
}

/** The library handler with the options of spec 3. Built lazily by the caller, never at import time. */
export function createHandler(deps: ToolDeps): McpHttpHandler {
  return createMcpHandler(createServerFactory(deps), {
    legacy: "stateless",
    maxRequestBodySize: MAX_BODY_BYTES,
    maxSubscriptions: 0,
    onerror: (e) => {
      try {
        deps.log({ event: "mcp_protocol_error", at: deps.now().toISOString(), message: shortMessage(e) });
      } catch {
        // a failing logger must not change the response
      }
    },
  });
}
