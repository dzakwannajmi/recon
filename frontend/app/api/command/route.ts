import { tools } from "@/agent/tools";
import { COMMAND_TOOL, parseCommandBody, summarize } from "@/lib/commands";
import { retryAfterHeader } from "@/lib/gateway/rate-limit";
import { chatLimiter } from "@/lib/chat-limiter";
import { describeError } from "@/lib/llm-errors";
import { signInGate } from "@/lib/auth/gate";

// A live check reads Horizon and a stellar.toml; no model is involved.
export const maxDuration = 60;

const MAX_BODY_BYTES = 2_000;
const TIMEOUT_MS = 30_000;

/**
 * POST /api/command { command, code } -> { text, steps }
 *
 * Runs one chat tool directly for a slash command the user typed (/status, /flags, /claims, /check, /evidence). No
 * model is called and no LLM budget is used. Only an allowlisted command name and a valid asset code are accepted;
 * the tool and its arguments are fixed here, never taken from the request. `/evidence` only looks up whether paid
 * detail exists (get_evidence_bundle moves no money); the payment is started by the page, never by this route.
 */
export async function POST(req: Request) {
  const limit = chatLimiter().check(req);
  if (limit.limited) {
    return Response.json({ error: "Too many commands. Wait a minute and try again." }, { status: 429, headers: { "Retry-After": retryAfterHeader(limit) } });
  }
  const denied = await signInGate();
  if (denied) return denied;
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return Response.json({ error: "Request is too long." }, { status: 413 });
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return Response.json({ error: "Request is too long." }, { status: 413 });

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Send { command, code }." }, { status: 400 });
  }
  const parsed = parseCommandBody(body);
  if (!parsed) return Response.json({ error: "Use one of /status, /flags, /claims, /check, /evidence with an asset code of 1-12 letters or digits." }, { status: 400 });

  const toolName = COMMAND_TOOL[parsed.command];
  const tool = tools.find((t) => t.name === toolName);
  if (!tool) return Response.json({ error: "That command is not available." }, { status: 500 });
  const args = { asset_code: parsed.code };
  try {
    const result = await tool.run(args, { abortSignal: AbortSignal.any([req.signal, AbortSignal.timeout(TIMEOUT_MS)]) });
    return Response.json({ text: summarize(parsed.command, parsed.code, result), steps: [{ tool: toolName, args, result }] });
  } catch (err) {
    console.error("Command failed:", describeError(err));
    return Response.json({ error: "The command could not be completed. Try again in a moment." }, { status: 500 });
  }
}
