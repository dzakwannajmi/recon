import { describe, expect, it } from "vitest";
import { createRateLimiter, type RateLimiterOptions } from "./rate-limit";

const req = (ip?: string) => new Request("http://localhost/api/check", { headers: ip ? { "x-forwarded-for": ip } : {} });

function make(opts: Partial<RateLimiterOptions> & { perIpPerMin: number; globalPerMin: number; trustProxy: boolean }) {
  const clock = { t: 0 };
  const logs: unknown[] = [];
  const l = createRateLimiter({ route: "test", now: () => clock.t, log: (line) => logs.push(line), ...opts });
  return { l, clock, logs, at: (t: number, r: Request) => ((clock.t = t), l.check(r)) };
}

describe("createRateLimiter", () => {
  it("limits the global bucket and opens a new window after 60 s", () => {
    const { at } = make({ perIpPerMin: 100, globalPerMin: 2, trustProxy: false });
    expect(at(0, req()).limited).toBe(false);
    expect(at(1, req()).limited).toBe(false);
    expect(at(2, req()).limited).toBe(true);
    expect(at(59_999, req()).limited).toBe(true);
    expect(at(60_000, req()).limited).toBe(false);
  });

  it("Retry-After is the whole seconds left in the window, at least 1", () => {
    const { at } = make({ perIpPerMin: 100, globalPerMin: 1, trustProxy: false });
    at(0, req());
    expect(at(10_000, req())).toEqual({ limited: true, retryAfterSeconds: 50 });
    expect(at(10_500, req())).toEqual({ limited: true, retryAfterSeconds: 50 });
    expect(at(59_999, req())).toEqual({ limited: true, retryAfterSeconds: 1 });
  });

  it("ignores X-Forwarded-For unless the proxy is trusted", () => {
    const { at } = make({ perIpPerMin: 1, globalPerMin: 100, trustProxy: false });
    expect(at(0, req("1.1.1.1")).limited).toBe(false);
    expect(at(1, req("1.1.1.1")).limited).toBe(false);
  });

  it("limits per IP when the proxy is trusted, and keeps clients apart", () => {
    const { at } = make({ perIpPerMin: 1, globalPerMin: 100, trustProxy: true });
    expect(at(0, req("1.1.1.1, 9.9.9.9")).limited).toBe(false);
    expect(at(1, req("1.1.1.1")).limited).toBe(true);
    expect(at(2, req("2.2.2.2")).limited).toBe(false);
  });

  it("counts a request in both buckets only when both accept it", () => {
    const { at } = make({ perIpPerMin: 1, globalPerMin: 3, trustProxy: true });
    expect(at(0, req("1.1.1.1")).limited).toBe(false); // global 1
    for (let i = 1; i <= 10; i++) expect(at(i, req("1.1.1.1")).limited).toBe(true); // refused by the IP: adds nothing to global
    expect(at(20, req("2.2.2.2")).limited).toBe(false); // global 2
    expect(at(21, req("3.3.3.3")).limited).toBe(false); // global 3
    expect(at(22, req("4.4.4.4")).limited).toBe(true); // global full
  });

  it("a request refused by the global bucket does not count against the IP", () => {
    const { at } = make({ perIpPerMin: 1, globalPerMin: 1, trustProxy: true });
    expect(at(0, req("1.1.1.1")).limited).toBe(false);
    expect(at(1, req("2.2.2.2")).limited).toBe(true); // global
    expect(at(60_000, req("2.2.2.2")).limited).toBe(false); // 2.2.2.2 was never counted
  });

  it("evicts the oldest client past maxClients without dropping the global bucket", () => {
    const { at } = make({ perIpPerMin: 1, globalPerMin: 1000, trustProxy: true, maxClients: 3 });
    for (let i = 0; i < 10; i++) at(i, req(`10.0.0.${i}`));
    expect(at(20, req("10.0.0.0")).limited).toBe(false); // evicted, so fresh
    expect(at(21, req("10.0.0.9")).limited).toBe(true); // still tracked
  });

  it("logs one rate_limited line per bucket per window, with route and bucket only", () => {
    const { at, logs } = make({ perIpPerMin: 1, globalPerMin: 100, trustProxy: true });
    at(0, req("1.1.1.1"));
    for (let i = 1; i <= 5; i++) at(i, req("1.1.1.1"));
    expect(logs).toEqual([{ event: "rate_limited", route: "test", bucket: "ip" }]);
    expect(JSON.stringify(logs)).not.toContain("1.1.1.1");
    at(60_000, req("1.1.1.1"));
    at(60_001, req("1.1.1.1"));
    expect(logs).toHaveLength(2); // next window, one more line
  });

  it("logs the global bucket once per window", () => {
    const { at, logs } = make({ perIpPerMin: 100, globalPerMin: 1, trustProxy: false });
    at(0, req());
    at(1, req());
    at(2, req());
    expect(logs).toEqual([{ event: "rate_limited", route: "test", bucket: "global" }]);
  });
});
