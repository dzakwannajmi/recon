/**
 * `data/feed/deployment.json`: the public record of the testnet deployment (spec 8.1).
 * The publisher and the verifier read the contract ID from here, never from the command line.
 */
import fs from "fs";
import path from "path";
import { StrKey } from "@stellar/stellar-sdk";
import { z } from "zod";
import { isIsoTime } from "../flags/types";

export const DATA_DIR = path.join(process.cwd(), "..", "data");
export const DEPLOYMENT_FILE = path.join(DATA_DIR, "feed", "deployment.json");
export const LOG_FILE = path.join(DATA_DIR, "feed", "log.json");

const hex64 = z.string().regex(/^[0-9a-f]{64}$/, "must be 64 lowercase hex characters");

export const deploymentSchema = z.object({
  network: z.literal("testnet"),
  contract_id: z.string().refine((s) => StrKey.isValidContract(s), "must be a contract address (C...)"),
  wasm_hash: hex64,
  deploy_tx: hex64,
  deployed_at: z.string().refine(isIsoTime, "must be an ISO time"),
  admin: z.string().refine((s) => StrKey.isValidEd25519PublicKey(s), "must be an account address (G...)"),
  publisher: z.string().refine((s) => StrKey.isValidEd25519PublicKey(s), "must be an account address (G...)"),
  sdk: z.string().min(1),
}).strict();

export type Deployment = z.infer<typeof deploymentSchema>;

/** Validate a parsed deployment record; `network` other than "testnet" is refused (golden rule 6). */
export function parseDeployment(json: unknown): Deployment {
  const parsed = deploymentSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`data/feed/deployment.json is invalid: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
  }
  return parsed.data;
}

export function loadDeployment(file = DEPLOYMENT_FILE): Deployment {
  if (!fs.existsSync(file)) throw new Error("data/feed/deployment.json does not exist; deploy the contract first");
  return parseDeployment(JSON.parse(fs.readFileSync(file, "utf8")));
}
