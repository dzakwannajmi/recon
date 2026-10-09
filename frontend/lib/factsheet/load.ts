/**
 * Reads the computed status (data/status/YYYY-MM-DD.json) for the fact sheet
 * pages. Read-only: no network, no LLM. The file is produced by `npm run status`.
 */
import fs from "fs";
import path from "path";
import { z } from "zod";
import { FLAG_ORDER, isIsoDay, type FlagName } from "../flags/types";
import type { AssetStatus } from "../flags/status";

const flagName = z.enum(FLAG_ORDER as [FlagName, ...FlagName[]]);
const nullableString = z.string().nullish();

const evidenceSchema = z.object({
  kind: z.enum(["chain_check", "examination", "claim", "source_fact", "snapshot"]),
  ref: z.string(),
  source_url: nullableString,
  snapshot_sha256: nullableString,
  quote: nullableString,
  where: nullableString,
}).loose();

const raisedSchema = z.object({
  flag: flagName,
  outcome: z.literal("raised"),
  severity: z.enum(["WARNING", "CRITICAL"]),
  effective_severity: z.enum(["WARNING", "CRITICAL"]),
  review: z.enum(["not_needed", "pending", "confirmed", "rejected"]),
  statement: z.string(),
  as_of: z.string(),
  evidence: z.array(evidenceSchema),
}).loose();

const clearSchema = z.object({
  flag: flagName,
  outcome: z.literal("clear"),
  reason: z.string(),
  as_of: z.string(),
  evidence: z.array(evidenceSchema),
}).loose();

const notEvaluatedSchema = z.object({
  flag: flagName,
  outcome: z.literal("not_evaluated"),
  reason: z.string(),
}).loose();

const assetSchema = z.object({
  asset: z.string(),
  asset_code: z.string().min(1),
  issuer: z.string(),
  issuer_org: z.string(),
  asset_type: z.string(),
  status: z.enum(["OK", "WARNING", "CRITICAL"]).nullable(),
  flags_bitmask: z.number().int().min(0),
  evidence_hash: z.string(),
  // Feed fields (D-038, D-039): absent in status files written before flags-v2.
  sac_contract_id: z.string().optional(),
  checked_at: nullableString,
  issuer_change_seen_at: nullableString,
  raised: z.array(raisedSchema),
  clear: z.array(clearSchema),
  not_evaluated: z.array(notEvaluatedSchema),
}).loose();

const inputSchema = z.object({
  path: z.string(),
  sha256: z.string(),
  checked_at: z.string().optional(),
}).loose().nullable();

const historyEntrySchema = z.object({ path: z.string(), sha256: z.string(), checked_at: z.string().optional() }).loose();

const statusSchema = z.object({
  generated_at: z.string(),
  as_of: z.string(),
  feed_schema: z.number().int().optional(),
  rules_version: z.string(),
  inputs: z.object({
    checks: inputSchema,
    previous_checks: inputSchema,
    checks_history: z.array(historyEntrySchema).optional(),
    examinations: inputSchema,
  }).loose(),
  bits: z.record(z.string(), z.number()),
  status_codes: z.record(z.string(), z.number()),
  summary: z.record(z.string(), z.number()),
  assets: z.array(assetSchema),
}).loose();

export type StatusInput = { path: string; sha256: string; checked_at?: string } | null;
/** One asset of a status file. The feed fields are optional: files written before flags-v2 do not have them. */
export type LoadedAsset = Omit<AssetStatus, "sac_contract_id" | "checked_at" | "issuer_change_seen_at"> &
  Partial<Pick<AssetStatus, "sac_contract_id" | "checked_at" | "issuer_change_seen_at">>;
export type StatusFile = {
  generated_at: string;
  as_of: string;
  feed_schema?: number;
  rules_version: string;
  inputs: {
    checks: StatusInput;
    previous_checks: StatusInput;
    checks_history?: { path: string; sha256: string; checked_at?: string }[];
    examinations: StatusInput;
  };
  bits: Record<string, number>;
  status_codes: Record<string, number>;
  summary: Record<string, number>;
  assets: LoadedAsset[];
};
export type LoadedStatus = { file: string; status: StatusFile };

/** The newest `YYYY-MM-DD.json` of a list of file names; anything else (tmp files, bad dates) is ignored. */
export function newestStatusFile(names: string[]): string | null {
  const days = names
    .map((n) => /^(\d{4}-\d{2}-\d{2})\.json$/.exec(n)?.[1])
    .filter((d): d is string => !!d && isIsoDay(d))
    .sort();
  const newest = days[days.length - 1];
  return newest ? `${newest}.json` : null;
}

export const defaultDataDir = () => path.join(process.cwd(), "..", "data");

const cache = new Map<string, LoadedStatus>();

/** Reads and validates the newest status file. Throws a clear error when there is none or it is invalid. */
export function loadStatus(dataDir: string = defaultDataDir()): LoadedStatus {
  const cached = cache.get(dataDir);
  if (cached) return cached;
  const dir = path.join(dataDir, "status");
  const names = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  const file = newestStatusFile(names);
  if (!file) throw new Error(`No data/status/YYYY-MM-DD.json found in ${dir}. Run: npm run status`);
  let json: unknown;
  try {
    json = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
  } catch (e) {
    throw new Error(`data/status/${file} is not valid JSON: ${(e as Error).message}`);
  }
  const parsed = statusSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`data/status/${file} is invalid: ${parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  if (parsed.data.as_of !== file.replace(/\.json$/, "")) {
    throw new Error(`data/status/${file} is invalid: as_of is ${parsed.data.as_of} but the file name says ${file.replace(/\.json$/, "")}`);
  }
  const loaded: LoadedStatus = { file, status: parsed.data as unknown as StatusFile };
  cache.set(dataDir, loaded);
  return loaded;
}
