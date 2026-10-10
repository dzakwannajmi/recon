/**
 * Sliding-window rate limiter for the check routes: the same algorithm as the chat route
 * (app/api/agent/route.ts), in a module of its own so each route gets its own buckets.
 * In memory and per server instance: enough for testnet, not for production (spec 6.1).
 */
export type RateLimiterOptions = {
  perIpPerMin: number;
  globalPerMin: number;
  /** Per-IP limits apply only behind a proxy that overwrites X-Forwarded-For; the global bucket always applies. */
  trustProxy: boolean;
  maxClients?: number;
};

export type RateLimiter = {
  /** True when this request is over a limit. Every call counts as a hit. */
  limited(req: Request, now?: number): boolean;
};

const WINDOW_MS = 60_000;

export function createRateLimiter(opts: RateLimiterOptions): RateLimiter {
  const maxClients = opts.maxClients ?? 10_000;
  const recentRequests = new Map<string, number[]>();

  function hit(key: string, limit: number, now: number) {
    const recent = (recentRequests.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
    recent.push(now);
    recentRequests.delete(key);
    recentRequests.set(key, recent);
    if (recentRequests.size > maxClients) {
      const oldest = recentRequests.keys().next().value;
      if (oldest !== undefined) recentRequests.delete(oldest);
    }
    return recent.length > limit;
  }

  return {
    limited(req, now = Date.now()) {
      if (hit("global", opts.globalPerMin, now)) return true;
      if (!opts.trustProxy) return false;
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
      return ip ? hit(`ip:${ip.slice(0, 64)}`, opts.perIpPerMin, now) : false;
    },
  };
}

export const RETRY_AFTER_SECONDS = "60";
