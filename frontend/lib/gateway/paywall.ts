/**
 * The paid wrapper (spec 4.2 and 4.3): x402 v2, `exact`, `stellar:testnet`, testnet USDC.
 *
 * `withX402` verifies the payment with the facilitator, runs the handler, and settles only when the
 * handler answers with a status below 400. The body leaves only after a successful settle; a failed
 * settle, a timeout, or a handler error returns no content. The server holds no signing key: the
 * facilitator rebuilds and submits the transaction and pays the fee (golden rules 6 and 8).
 *
 * Nothing here runs at import. `createPaidHandler` builds the server on the first request.
 * No price and no amount is written in this file: the amount comes from the configuration and
 * appears only in the protocol's PAYMENT-REQUIRED header (golden rule 7).
 */
import { createHash } from "node:crypto";
import { FacilitatorTimeoutError, x402ResourceServer, type FacilitatorClient, type HTTPRequestContext, type RouteConfig } from "@x402/core/server";
import { withX402 } from "@x402/next";
import { SettleError } from "@x402/core/types";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import type { NextRequest, NextResponse } from "next/server";
import { ERROR_MESSAGES } from "./copy";
import { MAX_TIMEOUT_SECONDS, NETWORK, USDC_TESTNET_SAC, type PaymentConfig } from "./payment-config";
import { parseQuery } from "./resolve";

// ---------------------------------------------------------------- replay memory

export type SeenSet = {
  has(hash: string): boolean;
  add(hash: string): void;
};

export const SEEN_TTL_MS = 10 * 60_000;
export const SEEN_MAX_ENTRIES = 10_000;

/**
 * Hashes of payments that settled, kept per server instance for 10 minutes (at most 10,000, oldest
 * evicted first). It only fails a repeat early, without a facilitator call: the Soroban nonce
 * on chain is the real guarantee that a signed payment settles at most once.
 */
export function createSeenSet(opts: { ttlMs?: number; max?: number; now?: () => number } = {}): SeenSet {
  const ttlMs = opts.ttlMs ?? SEEN_TTL_MS;
  const max = opts.max ?? SEEN_MAX_ENTRIES;
  const now = opts.now ?? Date.now;
  const map = new Map<string, number>();
  return {
    has(hash) {
      const expires = map.get(hash);
      if (expires === undefined) return false;
      if (expires <= now()) {
        map.delete(hash);
        return false;
      }
      return true;
    },
    add(hash) {
      map.delete(hash);
      map.set(hash, now() + ttlMs);
      while (map.size > max) {
        const oldest = map.keys().next().value;
        if (oldest === undefined) break;
        map.delete(oldest);
      }
    },
  };
}

// ---------------------------------------------------------------- logging

/** One JSON object per line. Never holds the amount, headers, or secrets. */
export type LogLine = Record<string, unknown>;
export type Logger = (line: LogLine) => void;

export const consoleLogger: Logger = (line) => console.log(JSON.stringify(line));

const sha256Hex = (text: string) => createHash("sha256").update(text).digest("hex");

/** A reason code the facilitator or a hook gave, if it looks like one; anything free-form becomes "unspecified". */
const reasonCode = (v: unknown): string => (typeof v === "string" && /^[A-Za-z0-9_.:-]{1,120}$/.test(v) ? v : "unspecified");

/** `CODE:ISSUER` from the validated query of the request a hook ran for, or null. */
function assetOf(transportContext: unknown): string | null {
  try {
    const request = (transportContext as { request?: HTTPRequestContext } | undefined)?.request;
    if (!request) return null;
    const q = parseQuery(new URL(request.adapter.getUrl()).searchParams);
    return q && q.issuer ? `${q.asset_code}:${q.issuer}` : q ? q.asset_code : null;
  } catch {
    return null;
  }
}

function freeSummaryPath(ctx: HTTPRequestContext): string {
  try {
    const q = parseQuery(new URL(ctx.adapter.getUrl()).searchParams);
    if (!q) return "/api/check";
    return `/api/check?asset_code=${encodeURIComponent(q.asset_code)}${q.issuer ? `&issuer=${encodeURIComponent(q.issuer)}` : ""}`;
  } catch {
    return "/api/check";
  }
}

// ---------------------------------------------------------------- the browser page

/** Static: no amount, no request data. Browsers get this instead of the library's page, which would show the amount. */
export const PAYWALL_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Paid detail: x402 on Stellar testnet</title>
</head>
<body>
<main>
<h1>Paid detail</h1>
<p>This endpoint is paid with the x402 protocol on Stellar testnet, in test USDC, which has no value. Use an x402 client: the payment requirements are in the PAYMENT-REQUIRED response header.</p>
<p>The same facts and flags stay free: <a href="/api/check">the free summary</a> and <a href="/en/assets">the asset fact sheets</a>.</p>
</main>
</body>
</html>
`;

// ---------------------------------------------------------------- the wrapper

export type PaidHandlerDeps = {
  config: PaymentConfig;
  facilitator: FacilitatorClient;
  /** The content. Runs only after a verified payment; the body is returned only after a successful settle. */
  handler: (req: NextRequest) => Promise<NextResponse>;
  seen: SeenSet;
  log: Logger;
  now?: () => Date;
};

export function routeConfigFor(config: PaymentConfig): RouteConfig {
  return {
    accepts: {
      scheme: "exact",
      network: NETWORK,
      payTo: config.payTo,
      price: { asset: USDC_TESTNET_SAC, amount: config.amount },
      maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
    },
    description:
      "Evidence bundle for one tokenized asset on Stellar: flags with evidence, issuer claims with verbatim quotes and snapshot hashes, stored chain facts, and a testnet feed cross-check. Stored checks as of the dates shown, not a live audit. Stellar testnet; test USDC has no value.",
    mimeType: "application/json",
    customPaywallHtml: PAYWALL_HTML,
    unpaidResponseBody: (ctx) => ({
      contentType: "application/json",
      body: { error: "payment_required", message: ERROR_MESSAGES.payment_required, protocol: "x402", network: NETWORK, free_summary: freeSummaryPath(ctx) },
    }),
    settlementFailedResponseBody: (_ctx, failed) => ({
      contentType: "application/json",
      body: {
        error: "settlement_failed",
        message: ERROR_MESSAGES.settlement_failed,
        reason: reasonCode(failed.errorReason),
        transaction: typeof failed.transaction === "string" && /^[0-9a-f]{64}$/i.test(failed.transaction) ? failed.transaction : null,
      },
    }),
  };
}

/** The payload hash a hook can compute, or null when the payload carries no transaction string. */
function payloadHash(payload: unknown): string | null {
  const tx = (payload as { payload?: { transaction?: unknown } } | undefined)?.payload?.transaction;
  return typeof tx === "string" && tx.length > 0 ? sha256Hex(tx) : null;
}

/**
 * The server with its hooks. Hooks never throw (a hook that throws is skipped by the library, which would
 * skip the check): `onBeforeVerify` answers `abort` on any internal error. No hook returns `skip` or `recovered`.
 */
export function buildResourceServer(deps: Pick<PaidHandlerDeps, "facilitator" | "seen" | "log" | "now">): x402ResourceServer {
  const { seen, log } = deps;
  const at = () => (deps.now ?? (() => new Date()))().toISOString();
  const emit = (event: string, fields: Record<string, unknown>) => {
    try {
      log({ event, at: at(), ...fields });
    } catch {
      // logging must never change the outcome
    }
  };

  return new x402ResourceServer(deps.facilitator)
    .register(NETWORK, new ExactStellarScheme())
    .onBeforeVerify(async (context) => {
      try {
        const h = payloadHash(context.paymentPayload);
        if (h === null) return { abort: true as const, reason: "payment_malformed" };
        if (seen.has(h)) {
          emit("x402_replay_refused", { asset: assetOf(context.transportContext), payload: h.slice(0, 16) });
          return { abort: true as const, reason: "payment_already_used" };
        }
      } catch {
        return { abort: true as const, reason: "payment_malformed" };
      }
    })
    .onAfterSettle(async (context) => {
      try {
        if (!context.result.success) return;
        const h = payloadHash(context.paymentPayload);
        if (h !== null) seen.add(h);
        emit("x402_settled", {
          asset: assetOf(context.transportContext),
          payer: context.result.payer ?? null,
          tx: context.result.transaction || null,
          payload: h ? h.slice(0, 16) : null,
        });
      } catch {
        // observed only
      }
    })
    .onSettleFailure(async (context) => {
      try {
        const h = payloadHash(context.paymentPayload);
        const base = { asset: assetOf(context.transportContext), payload: h ? h.slice(0, 16) : null };
        if (context.error instanceof FacilitatorTimeoutError) {
          // The outcome is unknown: the transaction can still land until its ledger bound.
          emit("x402_settle_unknown", { ...base, reason: "timeout" });
          return;
        }
        if (!(context.error instanceof SettleError)) {
          // Only a settle result the facilitator itself reported (success false) is a known failure. A connection
          // reset or a non-JSON 5xx says nothing about the chain: treat it as indeterminate.
          emit("x402_settle_unknown", { ...base, reason: reasonCode(context.error?.name) });
          return;
        }
        const err = context.error as { errorReason?: unknown; transaction?: unknown; payer?: unknown };
        const tx = typeof err.transaction === "string" && /^[0-9a-f]{64}$/i.test(err.transaction) ? err.transaction : null;
        emit("x402_settle_failed", {
          ...base,
          payer: typeof err.payer === "string" ? err.payer : null,
          tx,
          reason: reasonCode(err.errorReason ?? context.error.name),
        });
      } catch {
        // observed only
      }
    });
}

/**
 * The route handler for the paid detail. Lazy: the server is built, and the facilitator's `/supported`
 * is fetched, on the first request, never at import. A failed sync is retried on the next request.
 */
export function createPaidHandler(deps: PaidHandlerDeps): (req: NextRequest) => Promise<NextResponse> {
  let built: ((req: NextRequest) => Promise<NextResponse>) | null = null;
  return (req) => {
    built ??= withX402(deps.handler, routeConfigFor(deps.config), buildResourceServer(deps)) as (req: NextRequest) => Promise<NextResponse>;
    return built(req);
  };
}
