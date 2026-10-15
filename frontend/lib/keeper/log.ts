/**
 * `data/keeper/log.json`: a JSON array of every transaction the keeper and the demo sent. Append only;
 * never edited by hand. Each append writes a temporary file and renames it over the log.
 */
import fs from "node:fs";
import path from "node:path";
import type { Decision } from "./market";

export type DecisionJson = {
  reason: number;
  reason_name: string;
  status: number;
  flags: number;
  as_of: number;
  evidence_hash: string;
  published_ledger: number;
};

export type KeeperLogRecord = {
  at: string;
  network: "testnet";
  market: "live" | "demo";
  contract_id: string;
  method: string;
  asset_label: string;
  key: string;
  tx_hash: string;
  /** null only when `outcome` is "unknown". */
  ledger: number | null;
  /** The market's decision for the asset; null for a call that has none (a feed `publish`). */
  decision: DecisionJson | null;
  borrow_enabled_before: boolean | null;
  borrow_enabled_after: boolean | null;
  /** The demo step id (1 to 12), when the call came from `keeper:demo`. */
  step?: number;
  /** Present only on a transaction that was sent but never confirmed: look it up by hash before sending again. */
  outcome?: "unknown";
};

export function decisionToJson(d: Decision, reasonName: (code: number) => string): DecisionJson {
  return {
    reason: d.reason, reason_name: reasonName(d.reason), status: d.status, flags: d.flags,
    as_of: Number(d.as_of), evidence_hash: d.evidence_hash, published_ledger: d.published_ledger,
  };
}

/** The log as a list; a file that is not a JSON array throws. A missing file is an empty log. */
export function readKeeperLog(file: string): unknown[] {
  if (!fs.existsSync(file)) return [];
  const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(parsed)) throw new Error("data/keeper/log.json must be a JSON array");
  return parsed;
}

/** Append one record, writing atomically. Existing records are kept as they are. */
export function appendKeeperLog(file: string, record: KeeperLogRecord): void {
  const list = readKeeperLog(file);
  list.push(record);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2) + "\n");
  fs.renameSync(tmp, file);
}
