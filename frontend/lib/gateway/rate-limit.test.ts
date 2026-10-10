import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rate-limit";

const req = (ip?: string) => new Request("http://localhost/api/check", { headers: ip ? { "x-forwarded-for": ip } : {} });

describe("createRateLimiter", () => {
  it("limits the global bucket and lets the window slide", () => {
    const l = createRateLimiter({ perIpPerMin: 100, globalPerMin: 2, trustProxy: false });
    expect(l.limited(req(), 0)).toBe(false);
    expect(l.limited(req(), 1)).toBe(false);
    expect(l.limited(req(), 2)).toBe(true);
    expect(l.limited(req(), 61_000)).toBe(false); // every earlier hit has left the 60 s window
  });

  it("ignores X-Forwarded-For unless the proxy is trusted", () => {
    const l = createRateLimiter({ perIpPerMin: 1, globalPerMin: 100, trustProxy: false });
    expect(l.limited(req("1.1.1.1"), 0)).toBe(false);
    expect(l.limited(req("1.1.1.1"), 1)).toBe(false);
  });

  it("limits per IP when the proxy is trusted, and keeps clients apart", () => {
    const l = createRateLimiter({ perIpPerMin: 1, globalPerMin: 100, trustProxy: true });
    expect(l.limited(req("1.1.1.1, 9.9.9.9"), 0)).toBe(false);
    expect(l.limited(req("1.1.1.1"), 1)).toBe(true);
    expect(l.limited(req("2.2.2.2"), 2)).toBe(false);
  });

  it("evicts the oldest client past maxClients without dropping the global bucket", () => {
    const l = createRateLimiter({ perIpPerMin: 5, globalPerMin: 1000, trustProxy: true, maxClients: 3 });
    for (let i = 0; i < 10; i++) l.limited(req(`10.0.0.${i}`), i);
    expect(l.limited(req("10.0.0.0"), 20)).toBe(false);
  });
});
