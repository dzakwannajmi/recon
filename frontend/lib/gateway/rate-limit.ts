/**
 * Fixed-window rate limiter shared by every route (threat model A4). One window is one minute: a
 * `{start, count}` pair per key, so memory and time are O(1) per request. The per-IP and the global bucket
 * are both checked first, and a request is counted in both only when both accept it; a refused request
 * adds nothing. A fixed window allows up to twice the limit across a window edge, which is acceptable here.
 * In memory and per server instance: enough for testnet, not for production (spec 6.1).
 */
export type RateLimiterOptions = {
  /** The route name, used only in the `rate_limited` log line. */
  route: string;
  perIpPerMin: number;
  globalPerMin: number;
  /** Per-IP limits apply only behind a proxy that overwrites X-Forwarded-For; the global bucket always applies. */
  trustProxy: boolean;
  /** Most per-IP buckets kept at once; the oldest is evicted first. */
  maxClients?: number;
  /** Clock in ms, for tests. */
  now?: () => number;
  /** Receives one line per bucket per window: route and bucket name, never the IP. */
  log?: (line: { event: "rate_limited"; route: string; bucket: "global" | "ip" }) => void;
};

export type RateLimitResult = { limited: false } | { limited: true; retryAfterSeconds: number };

export type RateLimiter = {
  /** Counts the request when both buckets accept it; refuses without counting otherwise. */
  check(req: Request): RateLimitResult;
};

const WINDOW_MS = 60_000;

type Bucket = { start: number; count: number; logged: boolean };

const defaultLog: NonNullable<RateLimiterOptions["log"]> = (line) => console.log(JSON.stringify(line));

export function createRateLimiter(opts: RateLimiterOptions): RateLimiter {
  const maxClients = opts.maxClients ?? 10_000;
  const clock = opts.now ?? Date.now;
  const log = opts.log ?? defaultLog;
  const global: Bucket = { start: 0, count: 0, logged: false };
  const ips = new Map<string, Bucket>();

  /** The bucket if its window is still open at `now`; otherwise null (a fresh one starts on the first accepted request). */
  const open = (b: Bucket | undefined, now: number) => (b && now - b.start < WINDOW_MS ? b : null);

  /** Seconds left in the bucket's window, at least 1. */
  const retryAfter = (b: Bucket, now: number) => Math.max(1, Math.ceil((b.start + WINDOW_MS - now) / 1000));

  function refuse(b: Bucket, name: "global" | "ip", now: number): RateLimitResult {
    if (!b.logged) {
      b.logged = true;
      try {
        log({ event: "rate_limited", route: opts.route, bucket: name });
      } catch {
        // a failing logger must not change the response
      }
    }
    return { limited: true, retryAfterSeconds: retryAfter(b, now) };
  }

  return {
    check(req) {
      const now = clock();
      const g = open(global, now);
      if (g && g.count >= opts.globalPerMin) return refuse(g, "global", now);

      let ipKey: string | null = null;
      let ipBucket: Bucket | null = null;
      if (opts.trustProxy) {
        const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
        if (ip) {
          ipKey = ip.slice(0, 64);
          ipBucket = open(ips.get(ipKey), now);
          if (ipBucket && ipBucket.count >= opts.perIpPerMin) return refuse(ipBucket, "ip", now);
        }
      }

      // Both accept: count the request in both.
      if (g) g.count++;
      else Object.assign(global, { start: now, count: 1, logged: false });
      if (ipKey !== null) {
        if (ipBucket) ipBucket.count++;
        else {
          ips.delete(ipKey); // re-insert at the end so eviction is oldest-window-first
          ips.set(ipKey, { start: now, count: 1, logged: false });
          if (ips.size > maxClients) {
            const oldest = ips.keys().next().value;
            if (oldest !== undefined) ips.delete(oldest);
          }
        }
      }
      return { limited: false };
    },
  };
}

/** The Retry-After header value for a refused request. */
export const retryAfterHeader = (r: { retryAfterSeconds: number }) => String(r.retryAfterSeconds);
