import path from "path";
import type { NextConfig } from "next";

// data/ sits next to frontend/, so trace from the repo root and ship the files each route reads at runtime:
// the chat route's tools, and the two check routes (the free summary and the paid detail).
const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname, ".."),
  outputFileTracingIncludes: {
    "/api/agent": ["../data/assets.csv", "../data/status/*.json", "../data/claims/claims.json"],
    "/api/check": ["../data/assets.csv", "../data/status/*.json", "../data/feed/deployment.json"],
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
