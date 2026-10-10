/**
 * The real dependencies of the paid detail route. Built on the first request, never at import:
 * the facilitator client and the x402 server are created only once a valid, payable request arrives.
 * The server holds no signing key; the facilitator is `HTTPFacilitatorClient` with no auth headers (spec 4.2).
 */
import { HTTPFacilitatorClient } from "@x402/core/server";
import { positiveInt } from "../env";
import { createFeedReader, createRpc } from "../feed/reader";
import { createGatewayData } from "./data";
import { newDetailState, type DetailDeps } from "./handlers";
import { FACILITATOR_TIMEOUT_MS } from "./payment-config";
import { consoleLogger, createPaidHandler, createSeenSet } from "./paywall";
import { createRateLimiter } from "./rate-limit";

let detail: DetailDeps | null = null;

export function realDetailDeps(): DetailDeps {
  if (detail) return detail;
  const seen = createSeenSet();
  detail = {
    env: process.env,
    data: createGatewayData(),
    limiter: createRateLimiter({
      perIpPerMin: positiveInt("PAID_RATE_LIMIT_PER_MIN", 10),
      globalPerMin: positiveInt("PAID_GLOBAL_RATE_LIMIT_PER_MIN", 30),
      trustProxy: process.env.TRUST_PROXY === "true",
    }),
    buildPaid: (config, handler) =>
      createPaidHandler({
        config,
        facilitator: new HTTPFacilitatorClient({ url: config.facilitatorUrl, timeoutMs: FACILITATOR_TIMEOUT_MS }),
        handler,
        seen,
        log: consoleLogger,
      }),
    readerFactory: (contractId) => createFeedReader({ rpc: createRpc(), contractId }),
    log: consoleLogger,
    now: () => new Date(),
    state: newDetailState(),
  };
  return detail;
}
