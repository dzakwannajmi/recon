/**
 * The real dependencies of the MCP route. Built on the first request, never at import time.
 * Reads the environment and stored files only; no key, no LLM, no network at construction.
 */
import type { McpHttpHandler } from "@modelcontextprotocol/server";
import { positiveInt } from "../env";
import { createGatewayData } from "../gateway/data";
import { createRateLimiter } from "../gateway/rate-limit";
import type { HttpDeps } from "./http";
import { DEFAULT_RATE_GLOBAL_PER_MIN, DEFAULT_RATE_PER_IP_PER_MIN } from "./limits";
import { consoleLogger } from "./log";
import { createHandler } from "./server";

let cached: HttpDeps | null = null;

export function realMcpDeps(): HttpDeps {
  if (cached) return cached;
  const env = process.env;
  const data = createGatewayData();
  const now = () => new Date();
  const toolDeps = { env, data, log: consoleLogger, now };
  let handler: McpHttpHandler | null = null;
  cached = {
    env,
    limiter: createRateLimiter({
      perIpPerMin: positiveInt("MCP_RATE_LIMIT_PER_MIN", DEFAULT_RATE_PER_IP_PER_MIN),
      globalPerMin: positiveInt("MCP_GLOBAL_RATE_LIMIT_PER_MIN", DEFAULT_RATE_GLOBAL_PER_MIN),
      // Only trust X-Forwarded-For behind a proxy that overwrites it; otherwise clients could spoof it.
      trustProxy: env.TRUST_PROXY === "true",
    }),
    log: consoleLogger,
    now,
    mcp: () => (handler ??= createHandler(toolDeps)),
  };
  return cached;
}
