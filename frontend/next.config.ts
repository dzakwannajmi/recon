import path from "path";
import type { NextConfig } from "next";

// data/ sits next to frontend/, so trace from the repo root and ship the asset
// universe with the chat route: check_asset reads data/assets.csv at runtime.
const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname, ".."),
  outputFileTracingIncludes: { "/api/agent": ["../data/assets.csv"] },
};

export default nextConfig;
