import { WalletConfiguredError, WalletError, createWallet, explorerUrl, getWalletAddress, getWalletBalances } from "@/agent/wallet";
import { positiveInt } from "@/lib/env";
import { createRateLimiter, retryAfterHeader } from "@/lib/gateway/rate-limit";

const limiter = createRateLimiter({
  route: "wallet",
  perIpPerMin: positiveInt("WALLET_RATE_LIMIT_PER_MIN", 20),
  globalPerMin: positiveInt("WALLET_GLOBAL_RATE_LIMIT_PER_MIN", 60),
  // Only trust X-Forwarded-For behind a proxy that overwrites it; otherwise clients could spoof it.
  trustProxy: process.env.TRUST_PROXY === "true",
});

/** A 429 with Retry-After when the request is over a limit, otherwise null. */
function refused(req: Request) {
  const limit = limiter.check(req);
  if (!limit.limited) return null;
  return Response.json({ error: "Too many requests. Wait a minute and try again." }, { status: 429, headers: { "Retry-After": retryAfterHeader(limit) } });
}

function errorResponse(err: unknown) {
  // A configured wallet (AGENT_PUBLIC_KEY) is a conflict with "create one", not a server failure.
  if (err instanceof WalletConfiguredError) return Response.json({ error: err.message }, { status: 409 });
  if (err instanceof WalletError) return Response.json({ error: err.message }, { status: 500 });
  console.error("Wallet request failed:", (err as Error).name);
  return Response.json({ error: "Something went wrong. Try again in a moment." }, { status: 500 });
}

// GET /api/wallet -> the agent's wallet address and balances (or null if none yet)
export async function GET(req: Request) {
  const over = refused(req);
  if (over) return over;
  try {
    const address = getWalletAddress();
    if (!address) return Response.json({ address: null });

    const balance = await getWalletBalances()
      .then((balances) => balances.join(", "))
      .catch(() => "unavailable");
    return Response.json({ address, balance, explorer: explorerUrl(address) });
  } catch (err) {
    return errorResponse(err);
  }
}

// POST /api/wallet -> create the agent's testnet wallet and fund it with Friendbot
export async function POST(req: Request) {
  const over = refused(req);
  if (over) return over;
  try {
    return Response.json({ address: await createWallet() });
  } catch (err) {
    return errorResponse(err);
  }
}
