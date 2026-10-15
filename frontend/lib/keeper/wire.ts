/**
 * Wires the keeper and the demo to the real world for `scripts/keeper*.ts`: the testnet RPC, the committed
 * records, `data/assets.csv`, the stellar-cli signer, and the log. The only settings read from the
 * environment are `FEED_RPC_URL` and `FEED_RPC_ALLOW_HOSTS`, through `feedRpcUrl()`; no environment file is loaded.
 * Node runtime only. Nothing under `app/` or `agent/` may import this file.
 */
import path from "node:path";
import { loadUniverse } from "../chain/universe";
import { DATA_DIR, loadDeployment as loadReconFeed } from "../feed/deployment";
import { createFeedReader, createRpc, feedRpcUrl } from "../feed/reader";
import { publicKeyOf } from "./cli-signer";
import type { DemoDeps } from "./demo";
import { appendKeeperLog } from "./log";
import { createMarketReader, readFeedAssets, type LedgerRpc } from "./market";
import { LOG_FILE as KEEPER_LOG_FILE, loadDeployment, loadScenario, type MarketName } from "./records";
import { notEvaluatedFromStatus } from "./run";
import { invoke, simulateInvoke } from "./send";

/** Everything `runKeeper` and `runDemo` need, built from the records on disk and the shell environment. */
export function createDemoDeps(market: MarketName): DemoDeps {
  const rpcUrl = feedRpcUrl();
  // createRpc returns an rpc.Server, which also reads ledger entries (the executable check).
  const rpc = createRpc(rpcUrl) as ReturnType<typeof createRpc> & LedgerRpc;
  const deployment = loadDeployment();
  const { scenario, sha256 } = loadScenario();
  const recon = loadReconFeed();
  return {
    deployment,
    scenario,
    scenarioSha256: sha256,
    recon: { contract_id: recon.contract_id, admin: recon.admin, publisher: recon.publisher },
    universe: loadUniverse(),
    rpcUrl,
    rpc,
    market: createMarketReader({ rpc, contractId: deployment.markets[market].contract_id }),
    readEntries: (feedId, keys) => createFeedReader({ rpc, contractId: feedId }).readEntries(keys),
    feedRoles: (feedId) => createFeedReader({ rpc, contractId: feedId }).readRoles(),
    feedAssets: (feedId) => readFeedAssets(rpc, feedId),
    publicKeyOf: (identity) => publicKeyOf(identity),
    send: (req) => invoke(req, { rpc }),
    simulate: (req) => simulateInvoke(rpc, req),
    notEvaluated: (key) => notEvaluatedFromStatus(path.join(DATA_DIR, "status"), key),
    appendLog: (record) => appendKeeperLog(KEEPER_LOG_FILE, record),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => new Date(),
    out: (line) => console.log(line),
  };
}
