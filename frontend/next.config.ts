import path from "path";
import type { NextConfig } from "next";

// data/ sits next to frontend/, so trace from the repo root and ship the asset
// universe, the stored statuses, and the verified claims with the chat route: its tools read them at runtime.
const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname, ".."),
  outputFileTracingIncludes: {
    "/api/agent": ["../data/assets.csv", "../data/status/*.json", "../data/claims/claims.json"],
  },
};

export default nextConfig;
