/**
 * The real dependencies of the free summary route. Built on the first request, never at import.
 * Reads the environment and stored files only; no key, no LLM, no network at construction.
 */
import { positiveInt } from "../env";
import { createGatewayData } from "./data";
import type { SummaryDeps } from "./handlers";
import { createRateLimiter } from "./rate-limit";

let summary: SummaryDeps | null = null;

export function realSummaryDeps(): SummaryDeps {
  summary ??= {
    env: process.env,
    data: createGatewayData(),
    limiter: createRateLimiter({
      perIpPerMin: positiveInt("CHECK_RATE_LIMIT_PER_MIN", 30),
      globalPerMin: positiveInt("CHECK_GLOBAL_RATE_LIMIT_PER_MIN", 120),
      // Only trust X-Forwarded-For behind a proxy that overwrites it; otherwise clients could spoof it.
      trustProxy: process.env.TRUST_PROXY === "true",
    }),
  };
  return summary;
}
