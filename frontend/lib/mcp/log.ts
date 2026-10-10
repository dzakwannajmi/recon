/**
 * One JSON object per line (spec 7.3). Never the arguments as sent, quotes, bodies, an Origin value, or a stack trace.
 */
export type McpOutcome = "ok" | "not_tracked" | "ambiguous_asset" | "invalid_request" | "internal_error";

export type McpLogLine =
  | { event: "mcp_tool_call"; at: string; tool: string; outcome: McpOutcome; asset?: string; ms: number }
  | { event: "mcp_rejected"; at: string; reason: "origin" | "content_type" | "too_large" | "parse" | "batch" }
  | { event: "mcp_protocol_error"; at: string; message: string }
  | { event: "mcp_internal_error"; at: string; where: string; message: string };

export type McpLogger = (line: McpLogLine) => void;

/** The first 200 characters of an error message. */
export const shortMessage = (e: unknown): string => (e instanceof Error ? e.message : "unknown error").slice(0, 200);

export const consoleLogger: McpLogger = (line) => {
  console.log(JSON.stringify(line));
};
