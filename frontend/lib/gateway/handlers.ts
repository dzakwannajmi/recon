/**
 * The two check routes as plain functions with their dependencies injected (spec 4.4):
 * `handleSummary` is free, `handleDetail` is paid with x402 on Stellar testnet.
 * Both read stored files only. No LLM, no mainnet call, no key (golden rules 1, 6, 8, 11).
 *
 * Paid order: rate limit, payment header size, configuration, validate and resolve (errors are
 * free and never 402), then the x402 wrapper, whose inner handler builds the detail. A throw
 * anywhere outside the wrapper answers 500 and touches no payment.
 */
import type { NextRequest, NextResponse } from "next/server";
import { ERROR_MESSAGES, SCOPE_NOTE, type ErrorCode } from "./copy";
import type { GatewayData } from "./data";
import { MAX_DETAIL_BYTES, buildDetail, type EntryReader, type OnchainCache } from "./detail";
import { jsonResponse, jsonTextResponse, toJsonText } from "./json";
import { MAX_PAYMENT_HEADER_BYTES, paymentConfig, type Env, type PaymentConfig } from "./payment-config";
import type { Logger } from "./paywall";
import { RETRY_AFTER_SECONDS, type RateLimiter } from "./rate-limit";
import { parseQuery, resolveAsset, type Query, type Resolution } from "./resolve";
import { buildSummary } from "./summary";

export const SUMMARY_CACHE_CONTROL = "public, max-age=300, s-maxage=3600";
export const DETAIL_CACHE_CONTROL = "private, no-store";

export type SummaryDeps = {
  env: Env;
  data: GatewayData;
  limiter: RateLimiter;
};

/** Per-instance memory of the paid route: the wrapper is built once, and a configuration problem is logged once. */
export type DetailState = {
  paid: ((req: NextRequest) => Promise<NextResponse>) | null;
  configProblemLogged: boolean;
};
export const newDetailState = (): DetailState => ({ paid: null, configProblemLogged: false });

export type DetailDeps = SummaryDeps & {
  /** Wraps the content handler with the x402 payment flow. Built lazily on the first valid request. */
  buildPaid: (config: PaymentConfig, handler: (req: NextRequest) => Promise<NextResponse>) => (req: NextRequest) => Promise<NextResponse>;
  /** A reader for the feed contract (simulation only), or null when none can be built. */
  readerFactory: (contractId: string) => EntryReader | null;
  log: Logger;
  now: () => Date;
  state: DetailState;
  onchainCache?: OnchainCache;
  onchainDeadlineMs?: number;
};

// ---------------------------------------------------------------- responses

function errorResponse(code: ErrorCode, status: number, extras: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return jsonResponse({ error: code, message: ERROR_MESSAGES[code], ...extras }, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

const methodNotAllowed = () => errorResponse("invalid_request", 405, {}, { Allow: "GET" });

/**
 * A 5xx coming out of the x402 wrapper (facilitator unreachable, a settle timeout, a thrown handler) keeps its
 * status and protocol headers, but its body is replaced by a fixed sentence: text from the facilitator or from an
 * error never reaches the client.
 */
function fixedServerError(res: NextResponse) {
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  res.headers.forEach((value, name) => {
    if (!["content-type", "content-length", "content-encoding", "transfer-encoding", "cache-control"].includes(name.toLowerCase())) headers[name] = value;
  });
  return jsonResponse({ error: "internal_error", message: ERROR_MESSAGES.internal_error }, { status: res.status, headers });
}

const rateLimited = () =>errorResponse("rate_limited", 429, {}, { "Retry-After": RETRY_AFTER_SECONDS });
const invalidRequest = () => errorResponse("invalid_request", 400);
const internalError = (where: string, e: unknown) => {
  // The error text names files and fields, never secrets or amounts. The caller gets the fixed sentence only.
  console.error(`check ${where} failed:`, e instanceof Error ? e.message : "unknown error");
  return errorResponse("internal_error", 500);
};

/** The error response for a resolution that is not `found`. */
function resolutionError(r: Exclude<Resolution, { kind: "found" }>) {
  if (r.kind === "ambiguous_asset") return errorResponse("ambiguous_asset", 409, { issuers: r.issuers });
  return errorResponse("not_tracked", 404, {
    reason: r.reason,
    scope: SCOPE_NOTE,
    ...(r.tracked_issuers ? { tracked_issuers: r.tracked_issuers } : {}),
    ...(r.did_you_mean ? { did_you_mean: r.did_you_mean } : {}),
  });
}

// ---------------------------------------------------------------- free summary

export async function handleSummary(req: NextRequest, deps: SummaryDeps): Promise<NextResponse> {
  if (req.method !== "GET") return methodNotAllowed();
  try {
    if (deps.limiter.limited(req)) return rateLimited();
    const query = parseQuery(req.nextUrl.searchParams);
    if (!query) return invalidRequest();
    const loaded = deps.data.status();
    const universe = deps.data.universe();
    const r = resolveAsset(query, loaded.status, universe);
    if (r.kind !== "found") return resolutionError(r);
    const body = buildSummary({
      asset: r.asset,
      row: r.row,
      codeIsUnique: r.codeIsUnique,
      status: loaded,
      deployment: deps.data.deployment(),
      paidAvailable: paymentConfig(deps.env).ok,
    });
    return jsonResponse(body, { headers: { "Cache-Control": SUMMARY_CACHE_CONTROL } });
  } catch (e) {
    return internalError("summary", e);
  }
}

// ---------------------------------------------------------------- paid detail

const headerBytes = (req: NextRequest, name: string) => Buffer.byteLength(req.headers.get(name) ?? "");

/** The content handler: runs only after a verified payment, and re-resolves from the same stored files. */
function detailContent(deps: DetailDeps) {
  return async (req: NextRequest): Promise<NextResponse> => {
    const query = parseQuery(req.nextUrl.searchParams);
    if (!query) throw new Error("The query was valid before payment and is not now");
    const loaded = deps.data.status();
    const universe = deps.data.universe();
    const r = resolveAsset(query, loaded.status, universe);
    if (r.kind !== "found" || r.asset.status === null) throw new Error("The asset vanished between resolution and handling");
    const deployment = deps.data.deployment();
    let reader: EntryReader | null = null;
    try {
      reader = deployment ? deps.readerFactory(deployment.contract_id) : null;
    } catch {
      reader = null; // an RPC that cannot be built is an unavailable read, not a failed sale
    }
    const body = await buildDetail({
      asset: r.asset,
      row: r.row,
      loaded,
      claims: deps.data.claims(),
      universe,
      data: deps.data,
      reader,
      now: deps.now(),
      onchainCache: deps.onchainCache,
      onchainDeadlineMs: deps.onchainDeadlineMs,
    });
    const text = toJsonText(body);
    if (Buffer.byteLength(text) > MAX_DETAIL_BYTES) throw new Error("The detail is larger than the size bound");
    return jsonTextResponse(text, { headers: { "Cache-Control": DETAIL_CACHE_CONTROL } });
  };
}

export async function handleDetail(req: NextRequest, deps: DetailDeps): Promise<NextResponse> {
  // Next.js answers HEAD with the GET handler. A paid GET that returns no body to a HEAD client would be settled for nothing.
  if (req.method !== "GET") return methodNotAllowed();
  try {
    if (deps.limiter.limited(req)) return rateLimited();
    if (headerBytes(req, "payment-signature") > MAX_PAYMENT_HEADER_BYTES || headerBytes(req, "x-payment") > MAX_PAYMENT_HEADER_BYTES) return invalidRequest();

    const config = paymentConfig(deps.env);
    if (!config.ok) {
      if (!deps.state.configProblemLogged) {
        deps.state.configProblemLogged = true;
        // The reason name only: no value, never the amount, the address, or a secret.
        deps.log({ event: "x402_unavailable", at: deps.now().toISOString(), reason: config.reason });
      }
      return errorResponse("paid_detail_unavailable", 503);
    }

    const query: Query | null = parseQuery(req.nextUrl.searchParams);
    if (!query) return invalidRequest();
    const loaded = deps.data.status();
    const universe = deps.data.universe();
    const r = resolveAsset(query, loaded.status, universe);
    if (r.kind !== "found") return resolutionError(r);
    if (r.asset.status === null) return errorResponse("not_published", 409);

    deps.state.paid ??= deps.buildPaid(config.config, detailContent(deps));
    const res = await deps.state.paid(req);
    return res.status >= 500 ? fixedServerError(res) : res;
  } catch (e) {
    return internalError("detail", e);
  }
}
