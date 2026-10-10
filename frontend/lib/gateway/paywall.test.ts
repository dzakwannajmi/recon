import { describe, expect, it } from "vitest";
import { PAYWALL_HTML, createSeenSet, routeConfigFor } from "./paywall";
import { PAY_TO, SENTINEL_AMOUNT } from "./testkit";

describe("createSeenSet", () => {
  it("remembers a hash for the TTL and then forgets it", () => {
    let t = 0;
    const seen = createSeenSet({ ttlMs: 1000, now: () => t });
    seen.add("a");
    expect(seen.has("a")).toBe(true);
    t = 999;
    expect(seen.has("a")).toBe(true);
    t = 1000;
    expect(seen.has("a")).toBe(false);
  });

  it("evicts the oldest entries past the maximum", () => {
    const seen = createSeenSet({ max: 3, now: () => 0 });
    for (const h of ["a", "b", "c", "d", "e"]) seen.add(h);
    expect(["a", "b", "c", "d", "e"].map((h) => seen.has(h))).toEqual([false, false, true, true, true]);
  });
});

describe("routeConfigFor", () => {
  const config = { payTo: PAY_TO, amount: SENTINEL_AMOUNT, facilitatorUrl: "https://x402.org/facilitator" };

  it("is a bare route config with one exact testnet option and the static page", () => {
    const route = routeConfigFor(config);
    expect(route).not.toHaveProperty("/api/check/detail");
    expect(Array.isArray(route.accepts)).toBe(false);
    expect(route.accepts).toMatchObject({ scheme: "exact", network: "stellar:testnet", payTo: PAY_TO, maxTimeoutSeconds: 60 });
    expect((route.accepts as { extra?: unknown }).extra).toBeUndefined();
    expect(route.customPaywallHtml).toBe(PAYWALL_HTML);
  });

  it("keeps the amount out of the description and the static page", () => {
    const route = routeConfigFor(config);
    expect(route.description).not.toContain(SENTINEL_AMOUNT);
    expect(PAYWALL_HTML).not.toContain(SENTINEL_AMOUNT);
  });
});
