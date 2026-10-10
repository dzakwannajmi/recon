import type { NextRequest } from "next/server";
import { realDetailDeps } from "@/lib/gateway/deps-paid";
import { handleDetail } from "@/lib/gateway/handlers";

// The facilitator may take up to 80 s to settle (lib/gateway/payment-config.ts), plus a 4 s feed read.
export const maxDuration = 120;

// GET /api/check/detail?asset_code=CODE[&issuer=G...] -> the evidence bundle (check-detail/1), paid with x402 on Stellar testnet
export async function GET(req: NextRequest) {
  return handleDetail(req, realDetailDeps());
}
