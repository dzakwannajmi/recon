import path from "path";
import type { NextConfig } from "next";

// data/ sits next to frontend/, so trace from the repo root and ship the files each route reads at runtime:
// the chat route's tools, the two check routes (the free summary and the paid detail), and the MCP route.
/** Security headers for pages (threat model A12). API routes set their own headers (nosniff, no-store). */
export const PAGE_HEADERS = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/((?!api/).*)", headers: PAGE_HEADERS }];
  },
  outputFileTracingRoot: path.join(__dirname, ".."),
  outputFileTracingIncludes: {
    "/api/agent": ["../data/assets.csv", "../data/status/*.json", "../data/claims/claims.json"],
    "/api/check": ["../data/assets.csv", "../data/status/*.json", "../data/feed/deployment.json"],
    "/api/mcp": ["../data/assets.csv", "../data/status/*.json", "../data/feed/deployment.json"],
    "/api/check/detail": [
      "../data/assets.csv",
      "../data/status/*.json",
      "../data/checks/*.json",
      "../data/claims/claims.json",
      "../data/feed/deployment.json",
      "../data/feed/log.json",
    ],
  },
};

export default nextConfig;
