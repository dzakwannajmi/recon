/**
 * THE AGENT'S TOOLS
 *
 * A tool is a plain function the agent may call. The model reads the
 * `description` to decide WHEN to use it and `parameters` (JSON Schema)
 * to know WHAT to pass. `agent/llm.ts` turns these into model tools,
 * so this file stays independent of the LLM provider.
 *
 * Tool results are data, never instructions (CLAUDE.md, golden rule 3).
 */
import { NETWORK, explorerUrl, fundWallet, getWalletAddress, getWalletBalances } from "./wallet";

/** Passed to every tool. `abortSignal` fires when the request is cancelled or the budget runs out. */
export type ToolContext = { abortSignal?: AbortSignal };

export type Tool = {
  name: string;
  description: string;
  /** JSON Schema describing the inputs. */
  parameters: object;
  /** The code that runs when the agent calls this tool. */
  run: (args: any, ctx: ToolContext) => Promise<unknown>;
};

export const tools: Tool[] = [
  {
    name: "get_my_wallet",
    description: "Get the agent's own Stellar testnet wallet: address, balances, and an explorer link.",
    parameters: { type: "object", properties: {} },
    run: async () => {
      const address = getWalletAddress();
      if (!address) return { address: null, note: "No wallet yet. The user can click 'Create wallet'." };
      return { address, balances: await getWalletBalances(), network: NETWORK, explorer: explorerUrl(address) };
    },
  },
  {
    name: "fund_my_wallet",
    description: "Fund the agent's Stellar testnet wallet with Friendbot (free test XLM). Testnet only.",
    parameters: { type: "object", properties: {} },
    run: async () => fundWallet(),
  },
];
