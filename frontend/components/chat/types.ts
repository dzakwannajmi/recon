export type Step = { tool: string; args: unknown; result: any; error?: boolean };
export type Message = { role: "user" | "agent"; text: string; steps?: Step[]; error?: boolean; /** Seconds the agent took to answer. */ elapsed?: number };
/** What `send` hands back: the agent's reply as plain markdown text, or the error message. Null if nothing was sent or the request was stopped. */
export type Reply = { text: string; error: boolean } | null;
/** One model the user may pick in the chat (from GET /api/agent). */
export type ChatModelInfo = { id: string; label: string; note: string | null; default: boolean };
export type Status = { hasApiKey: boolean; provider?: string; keyEnv?: string | null; model: string; models?: ChatModelInfo[]; tools: { name: string; description: string }[] };
export type WalletInfo = { address: string | null; balance?: string };

/** Display names for the provider ids the status endpoint returns. */
export const PROVIDER_NAMES: Record<string, string> = { google: "Gemini", groq: "Groq", openrouter: "OpenRouter" };

export const EXAMPLES = ["Check USTRY on Stellar mainnet", "What's in your wallet?", "Fund your wallet on testnet", "What can you check for me?"];
