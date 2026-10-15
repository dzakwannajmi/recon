import { describe, expect, it } from "vitest";
import nextConfig from "./next.config";

describe("A12: security headers for pages", () => {
  it("sends frame-ancestors none, nosniff, and a Referrer-Policy on every non-API path", async () => {
    const rules = await nextConfig.headers!();
    expect(rules).toHaveLength(1);
    const [rule] = rules;
    const re = new RegExp(`^${rule.source}$`);
    for (const page of ["/", "/en", "/en/assets/gBENJI", "/icon.svg"]) expect(re.test(page), page).toBe(true);
    for (const api of ["/api/check", "/api/mcp", "/api/agent"]) expect(re.test(api), api).toBe(false);
    const map = Object.fromEntries(rule.headers.map((h) => [h.key, h.value]));
    expect(map["Content-Security-Policy"]).toBe("frame-ancestors 'none'");
    expect(map["X-Content-Type-Options"]).toBe("nosniff");
    expect(map["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
  });
});
