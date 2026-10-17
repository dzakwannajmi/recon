import { describeError, providerFailure } from "@/lib/llm-errors";
import { MODEL, runAgent, type ChatMessage } from "@/agent/agent";
import { BudgetExceededError, PROVIDER, apiKeyEnvName, budgetLeft, findRequestLimit, hasApiKey } from "@/agent/llm";
import { availableChatModels, resolveChatModel, toPublic } from "@/agent/models";
import { tools } from "@/agent/tools";
import { WalletError } from "@/agent/wallet";
import { retryAfterHeader } from "@/lib/gateway/rate-limit";
import { chatLimiter } from "@/lib/chat-limiter";

// Up to 5 model steps with a 60s timeout (agent/llm.ts).
export const maxDuration = 60;

const MAX_BODY_BYTES = 100_000;
const MAX_HISTORY = 20;
const MAX_MESSAGE_CHARS = 4000;

// GET /api/agent -> setup status + the list of tools (shown on the page)
export async function GET() {
  return Response.json({
    hasApiKey: hasApiKey(),
    provider: PROVIDER,
    keyEnv: apiKeyEnvName(PROVIDER),
    model: MODEL,
    budgetLeft: budgetLeft(),
    // The models the user may pick: id, label, note, default. No provider, model string, or key names.
    models: toPublic(availableChatModels()),
    tools: tools.map((t) => ({ name: t.name, description: t.description })),
  });
}

// POST /api/agent { messages, model? } -> the agent's answer + the tools it used
export async function POST(req: Request) {
  const limit = chatLimiter().check(req);
  if (limit.limited) {
    return Response.json(
      { error: "Too many messages. Wait a minute and try again." },
      { status: 429, headers: { "Retry-After": retryAfterHeader(limit) } },
    );
  }

  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return Response.json({ error: "Message is too long." }, { status: 413 });
  }
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return Response.json({ error: "Message is too long." }, { status: 413 });

  let body: { messages?: unknown; model?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Send { messages: [...] }." }, { status: 400 });
  }
  if (!Array.isArray(body?.messages) || body.messages.length === 0) {
    return Response.json({ error: "Send { messages: [...] }." }, { status: 400 });
  }
  const history: ChatMessage[] = body.messages
    .slice(-MAX_HISTORY)
    .map(
      (m: { role?: string; text?: unknown } | null): ChatMessage => ({
        role: m?.role === "user" ? "user" : "agent",
        text: String(m?.text ?? "").slice(0, MAX_MESSAGE_CHARS),
      }),
    )
    .filter((m: ChatMessage) => m.text.trim() !== "");
  if (history.at(-1)?.role !== "user") {
    return Response.json({ error: "The last message must be from the user." }, { status: 400 });
  }

  // The client sends only an allowlist id. Anything else is refused; the id is never used as a model or provider name.
  const chat = resolveChatModel(body.model);
  if (!chat) return Response.json({ error: "That model is not available. Pick another one." }, { status: 400 });
  if (!hasApiKey(chat.provider)) {
    const error = process.env.VERCEL
      ? "The demo has no LLM key configured yet."
      : `Add ${apiKeyEnvName(chat.provider) ?? "an API key for LLM_PROVIDER"} to frontend/.env, then restart \`npm run dev\`.`;
    return Response.json({ error }, { status: 500 });
  }

  try {
    return Response.json(await runAgent(history, chat));
  } catch (err) {
    if (err instanceof BudgetExceededError) return Response.json({ error: err.message }, { status: 429 });
    // Checked first: a retry wrapper can hold our own request-limit error (AI_RetryError.lastError).
    const limited = findRequestLimit(err);
    if (limited) return Response.json({ error: limited.message }, { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } });
    if (err instanceof WalletError) return Response.json({ error: err.message }, { status: 500 });
    console.error("Agent request failed:", describeError(err));
    // A provider 429 or 503 gets a plain answer with advice; there is no silent fallback to another provider.
    const busy = providerFailure(err);
    if (busy) return Response.json({ error: busy.message }, { status: busy.status });
    return Response.json({ error: "Something went wrong. Try again in a moment." }, { status: 500 });
  }
}
