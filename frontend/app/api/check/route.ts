import type { NextRequest } from "next/server";
import { realSummaryDeps } from "@/lib/gateway/deps";
import { handleSummary } from "@/lib/gateway/handlers";

// Reads stored files only: no LLM, no key, no network call.
export const maxDuration = 10;

// GET /api/check?asset_code=CODE[&issuer=G...] -> the free summary (check-summary/1)
export async function GET(req: NextRequest) {
  return handleSummary(req, realSummaryDeps());
}
