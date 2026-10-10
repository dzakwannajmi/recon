/**
 * Loaders for the check routes (spec 3.1). Read-only: the stored status, the asset universe, the
 * verified claims, one checks file, the feed deployment record, and the feed publish log.
 * No network, no LLM, no keys. Files that change only on deploy are cached by modification time.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { readClaims } from "../agent-data/claims";
import { loadUniverse, type UniverseAsset } from "../chain/universe";
import type { Claim } from "../claims/store";
import { defaultDataDir, loadStatus, type LoadedStatus } from "../factsheet/load";
import { loadDeployment, type Deployment } from "../feed/deployment";

/** `status.inputs.checks.path` must look like this before any file is opened. */
export const CHECKS_PATH = /^data\/checks\/\d{4}-\d{2}-\d{2}\.json$/;

export type ChecksFile = { sha256: string; rows: Record<string, unknown>[] };

export type PublishedBy = { tx_hash: string; ledger: number; at: string; commit: string; explorer: string };

export interface GatewayData {
  /** The newest status file. Throws when there is none or it is invalid. */
  status(): LoadedStatus;
  /** The asset universe. Throws when it is empty (fail loudly). */
  universe(): UniverseAsset[];
  claims(): Claim[];
  /** A checks file by its repo-relative path, or null when the path is not allowed, the file is missing, or it is not valid JSON. */
  checks(relPath: string): ChecksFile | null;
  /** The testnet feed deployment record, or null when it cannot be read. */
  deployment(): Deployment | null;
  /** The newest confirmed publish record that holds this key with this evidence hash, or null. */
  publishedBy(sacContractId: string, evidenceHash: string, contractId: string | null): PublishedBy | null;
}

const sha256Hex = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

/** Cache keyed by file, valid while the modification time is the same. */
function mtimeCache<T>() {
  const map = new Map<string, { mtimeMs: number; value: T }>();
  return (file: string, load: () => T): T => {
    const mtimeMs = fs.statSync(file).mtimeMs;
    const hit = map.get(file);
    if (hit && hit.mtimeMs === mtimeMs) return hit.value;
    const value = load();
    map.set(file, { mtimeMs, value });
    return value;
  };
}

const logRecordSchema = z.object({
  at: z.string(),
  network: z.literal("testnet"),
  contract_id: z.string(),
  tx_hash: z.string().regex(/^[0-9a-f]{64}$/),
  ledger: z.number().int().positive().nullable(),
  commit: z.string(),
  outcome: z.string().optional(),
  assets: z.array(z.object({ sac_contract_id: z.string(), evidence_hash: z.string() }).loose()),
}).loose();
type LogRecord = z.infer<typeof logRecordSchema>;

export const explorerTxUrl = (hash: string) => `https://stellar.expert/explorer/testnet/tx/${hash}`;

/** The newest confirmed record for this key and hash. A record that was sent but never confirmed (no ledger) is not "published by". */
export function findPublishedBy(records: readonly LogRecord[], sacContractId: string, evidenceHash: string, contractId: string | null): PublishedBy | null {
  for (let i = records.length - 1; i >= 0; i--) {
    const r = records[i];
    if (r.outcome === "unknown" || r.ledger === null) continue;
    if (contractId !== null && r.contract_id !== contractId) continue;
    if (!r.assets.some((a) => a.sac_contract_id === sacContractId && a.evidence_hash === evidenceHash)) continue;
    return { tx_hash: r.tx_hash, ledger: r.ledger, at: r.at, commit: r.commit, explorer: explorerTxUrl(r.tx_hash) };
  }
  return null;
}

/** `dataDir` is the `data/` folder. Without it the routes read `../data` next to `frontend/`, and `ASSETS_CSV` is honored. */
export function createGatewayData(dataDir?: string): GatewayData {
  const dir = dataDir ?? defaultDataDir();
  const explicitDir = dataDir !== undefined;
  const csvCache = mtimeCache<UniverseAsset[]>();
  const checksCache = mtimeCache<ChecksFile | null>();
  const deploymentCache = mtimeCache<Deployment | null>();
  const logCache = mtimeCache<LogRecord[] | null>();

  const records = (): LogRecord[] | null => {
    const file = path.join(dir, "feed", "log.json");
    if (!fs.existsSync(file)) return null;
    return logCache(file, () => {
      try {
        const json: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
        if (!Array.isArray(json)) return null;
        // One bad record does not hide the others.
        return json.flatMap((item) => {
          const parsed = logRecordSchema.safeParse(item);
          return parsed.success ? [parsed.data] : [];
        });
      } catch {
        return null;
      }
    });
  };

  return {
    status: () => loadStatus(dir),
    universe() {
      const csv = explicitDir ? path.join(dir, "assets.csv") : (process.env.ASSETS_CSV || path.join(dir, "assets.csv"));
      const universe = fs.existsSync(csv) ? csvCache(csv, () => loadUniverse(csv)) : [];
      if (universe.length === 0) throw new Error("The asset universe is empty or missing (data/assets.csv)");
      return universe;
    },
    claims: () => readClaims(path.join(dir, "claims")),
    checks(relPath) {
      if (!CHECKS_PATH.test(relPath)) return null;
      const file = path.join(dir, relPath.slice("data/".length));
      if (!fs.existsSync(file)) return null;
      return checksCache(file, () => {
        const bytes = fs.readFileSync(file);
        try {
          const json = JSON.parse(bytes.toString("utf8")) as { results?: unknown };
          const rows = Array.isArray(json.results) ? json.results.filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null) : [];
          return { sha256: sha256Hex(bytes), rows };
        } catch {
          return null;
        }
      });
    },
    deployment() {
      const file = path.join(dir, "feed", "deployment.json");
      if (!fs.existsSync(file)) return null;
      return deploymentCache(file, () => {
        try {
          return loadDeployment(file);
        } catch {
          return null;
        }
      });
    },
    publishedBy: (sac, hash, contractId) => findPublishedBy(records() ?? [], sac, hash, contractId),
  };
}
