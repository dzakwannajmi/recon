import { WalletConfiguredError, WalletError, createWallet, explorerUrl, getWalletAddress, getWalletBalances } from "@/agent/wallet";

function errorResponse(err: unknown) {
  // A configured wallet (AGENT_PUBLIC_KEY) is a conflict with "create one", not a server failure.
  if (err instanceof WalletConfiguredError) return Response.json({ error: err.message }, { status: 409 });
  if (err instanceof WalletError) return Response.json({ error: err.message }, { status: 500 });
  console.error("Wallet request failed:", (err as Error).name);
  return Response.json({ error: "Something went wrong. Try again in a moment." }, { status: 500 });
}

// GET /api/wallet -> the agent's wallet address and balances (or null if none yet)
export async function GET() {
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
export async function POST() {
  try {
    return Response.json({ address: await createWallet() });
  } catch (err) {
    return errorResponse(err);
  }
}
