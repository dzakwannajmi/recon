/**
 * The HTTP wrapper around the library handler (spec 3.1). Order:
 * method, rate limit (before the body is read), Origin, Content-Type, body cap, JSON, batch refusal,
 * the library, then `finalize` (headers, wire escaping, response cap).
 * Every error written here has a fixed sentence; no request value is ever echoed or logged.
 */
import { isJsonContentType, type McpHttpHandler } from "@modelcontextprotocol/server";
import { RETRY_AFTER_SECONDS, type RateLimiter } from "../gateway/rate-limit";
import type { Env } from "../gateway/payment-config";
import { escapeInvisible } from "../gateway/text";
import { HTTP_MESSAGES } from "./copy";
import { MAX_BODY_BYTES, MAX_RESPONSE_BYTES } from "./limits";
import { shortMessage, type McpLogger } from "./log";

export type HttpDeps = {
  /** Read only for MCP_ALLOWED_ORIGINS. */
  env: Env;
  limiter: RateLimiter;
  log: McpLogger;
  now: () => Date;
  /** The library handler. Built lazily on first use. */
  mcp: () => McpHttpHandler;
};

/** The origins listed in `MCP_ALLOWED_ORIGINS` (comma-separated), normalized; entries that are not valid URLs are ignored. */
export function parseAllowedOrigins(raw: string | undefined): Set<string> {
  const out = new Set<string>();
  for (const part of (raw ?? "").split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    try {
      const origin = new URL(trimmed).origin;
      if (origin !== "null") out.add(origin);
    } catch {
      // ignored
    }
  }
  return out;
}

/** Reads a request body as UTF-8 text, stopping at `max` bytes. `null` means over the cap (the read is cancelled). */
export async function readBoundedText(req: Request, max: number): Promise<string | null> {
  const declared = req.headers.get("content-length");
  if (declared !== null && Number(declared) > max) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

const BASE_HEADERS = { "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" } as const;

function rpcError(status: number, code: number, message: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code, message } }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...BASE_HEADERS, ...headers },
  });
}

class ResponseTooLarge extends Error {}

/** Reads a body to the end, up to `max` bytes; throws `ResponseTooLarge` above it. */
async function readAll(body: ReadableStream<Uint8Array>, max: number): Promise<string> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      throw new ResponseTooLarge();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Adds the two headers; every response that has a body is read to the end (capped), has its invisible and
 * direction-changing characters escaped, and is returned as a new response. The cap is checked again after
 * escaping, because escapes are longer than the characters they replace. For JSON the value is unchanged:
 * those characters are not JSON whitespace, so they can only sit inside strings, and SSE framing lines are ASCII.
 */
export async function finalize(res: Response, maxBytes = MAX_RESPONSE_BYTES): Promise<Response> {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(BASE_HEADERS)) headers.set(k, v);
  if (!res.body) return new Response(null, { status: res.status, statusText: res.statusText, headers });
  const text = escapeInvisible(await readAll(res.body, maxBytes));
  if (Buffer.byteLength(text) > maxBytes) throw new ResponseTooLarge();
  headers.delete("content-length");
  return new Response(text, { status: res.status, statusText: res.statusText, headers });
}

export async function handleMcp(req: Request, deps: HttpDeps): Promise<Response> {
  const reject = (reason: "origin" | "content_type" | "too_large" | "parse" | "batch") => {
    try {
      deps.log({ event: "mcp_rejected", at: deps.now().toISOString(), reason });
    } catch {
      // a failing logger must not change the response
    }
  };
  try {
    if (req.method !== "POST") return rpcError(405, -32000, HTTP_MESSAGES.method_not_allowed, { Allow: "POST" });

    if (deps.limiter.limited(req)) return rpcError(429, -32000, HTTP_MESSAGES.rate_limited, { "Retry-After": RETRY_AFTER_SECONDS });

    const origin = req.headers.get("origin");
    if (origin !== null) {
      let normalized: string | null = null;
      try {
        normalized = new URL(origin).origin;
      } catch {
        normalized = null;
      }
      if (normalized === null || !parseAllowedOrigins(deps.env.MCP_ALLOWED_ORIGINS).has(normalized)) {
        reject("origin");
        return rpcError(403, -32000, HTTP_MESSAGES.origin);
      }
    }

    if (!isJsonContentType(req.headers.get("content-type"))) {
      reject("content_type");
      return rpcError(415, -32000, HTTP_MESSAGES.content_type);
    }

    const text = await readBoundedText(req, MAX_BODY_BYTES);
    if (text === null) {
      reject("too_large");
      return rpcError(413, -32000, HTTP_MESSAGES.too_large);
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(text);
    } catch {
      reject("parse");
      return rpcError(400, -32700, HTTP_MESSAGES.parse);
    }
    if (Array.isArray(parsedBody)) {
      reject("batch");
      return rpcError(400, -32600, HTTP_MESSAGES.batch);
    }

    // A fresh request with the same bytes keeps the library correct whether or not it reads the body itself.
    const forward = new Request(req.url, { method: "POST", headers: req.headers, body: text, signal: req.signal });
    const res = await deps.mcp().fetch(forward, { parsedBody });
    return await finalize(res);
  } catch (e) {
    if (e instanceof ResponseTooLarge) {
      try {
        deps.log({ event: "mcp_internal_error", at: deps.now().toISOString(), where: "mcp_response_too_large", message: "response over the size cap" });
      } catch {
        // ignored
      }
    } else {
      console.error("mcp request failed:", shortMessage(e));
    }
    return rpcError(500, -32603, HTTP_MESSAGES.internal);
  }
}
