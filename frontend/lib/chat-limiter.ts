/**
 * One rate limiter for every chat-side route (/api/agent and /api/command). Each route is its own module, so the
 * instance is kept on globalThis: the global bucket (GLOBAL_RATE_LIMIT_PER_MIN) then covers model chats and live
 * command reads together, and the per-IP bucket covers both too. Created on first use, from the environment.
 */
import { positiveInt } from "./env";
import { createRateLimiter, type RateLimiter } from "./gateway/rate-limit";

const KEY = Symbol.for("chat.rate-limiter");
type Holder = { [KEY]?: RateLimiter };

export function chatLimiter(): RateLimiter {
  const g = globalThis as Holder;
  g[KEY] ??= createRateLimiter({
    route: "chat",
    perIpPerMin: positiveInt("CHAT_RATE_LIMIT_PER_MIN", 10),
    globalPerMin: positiveInt("GLOBAL_RATE_LIMIT_PER_MIN", 30),
    // Only trust X-Forwarded-For behind a proxy that overwrites it; otherwise clients could spoof it.
    trustProxy: process.env.TRUST_PROXY === "true",
  });
  return g[KEY];
}

/** For tests: forget the instance so the next request builds one from the current environment. */
export function resetChatLimiter() {
  delete (globalThis as Holder)[KEY];
}
