import type { NextRequest } from "next/server";
import { realDetailDeps } from "@/lib/gateway/deps-paid";
import { handleDetail } from "@/lib/gateway/handlers";

// Worst case: verify (80 s) + settle (80 s) + the library's one retry of a pending settle (80 s), plus a 4 s feed read.
export const maxDuration = 300;

// GET /api/check/detail?asset_code=CODE[&issuer=G...] -> the evidence bundle (check-detail/1), paid with x402 on Stellar testnet
export async function GET(req: NextRequest) {
  return handleDetail(req, realDetailDeps());
}
