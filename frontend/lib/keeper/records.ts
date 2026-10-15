/**
 * `data/keeper/deployment.json` and `data/keeper/scenario.json` (spec 4.2): the public record of the mock
 * market deployment and the synthetic scenario of the demo. Public keys and IDs only; no secret here.
 * Node runtime only; no LLM (golden rule 1).
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Asset, Networks, StrKey } from "@stellar/stellar-sdk";
import { z } from "zod";
import { canonicalJson } from "../flags/status";
import { isIsoTime } from "../flags/types";

export const KEEPER_DIR = path.join(process.cwd(), "..", "data", "keeper");
export const DEPLOYMENT_FILE = path.join(KEEPER_DIR, "deployment.json");
export const SCENARIO_FILE = path.join(KEEPER_DIR, "scenario.json");
export const LOG_FILE = path.join(KEEPER_DIR, "log.json");

/** The stellar-cli identities of the keeper and the demo (spec 5). */
export const IDENTITIES = {
  admin: "lending-admin",
  keeper: "lending-keeper",
  borrower: "lending-borrower",
  writer: "demo-feed-writer",
} as const;

export const DEMO_PURPOSE = "Synthetic test data for the keeper demo. Not Recon's feed. No real asset.";
export const SYNTH_CODE = "SYNTH";

const hex64 = z.string().regex(/^[0-9a-f]{64}$/, "must be 64 lowercase hex characters");
const account = z.string().refine((s) => StrKey.isValidEd25519PublicKey(s), "must be an account address (G...)");
const contract = z.string().refine((s) => StrKey.isValidContract(s), "must be a contract address (C...)");
const isoTime = z.string().refine(isIsoTime, "must be an ISO time");

const marketAssetSchema = z.object({
  label: z.string().min(1),
  /** `CODE:ISSUER` for a real asset in data/assets.csv; null for the synthetic one. */
  asset: z.string().regex(/^[A-Za-z0-9]{1,12}:G[A-Z2-7]{55}$/).nullable(),
  key: contract,
}).strict();

const marketSchema = z.object({
  contract_id: contract,
  deploy_tx: hex64,
  deployed_at: isoTime,
  feed: contract,
  pause_at: z.union([z.literal(1), z.literal(2)]),
  max_age_secs: z.number().int().min(60).max(2_592_000),
  assets: z.array(marketAssetSchema).min(1),
}).strict();

export const deploymentSchema = z.object({
  network: z.literal("testnet"),
  sdk: z.string().min(1),
  lending_wasm_hash: hex64,
  admin: account,
  keeper: account,
  borrower: account,
  markets: z.object({ live: marketSchema, demo: marketSchema }).strict(),
  demo_feed: z.object({
    contract_id: contract,
    deploy_tx: hex64,
    deployed_at: isoTime,
    wasm_hash: hex64,
    writer: account,
    purpose: z.literal(DEMO_PURPOSE),
  }).strict(),
}).strict();

export type KeeperDeployment = z.infer<typeof deploymentSchema>;
export type MarketRecord = KeeperDeployment["markets"]["live"];
export type MarketName = "live" | "demo";

export const scenarioStepIds = ["open", "critical", "clean"] as const;
export type ScenarioStepId = (typeof scenarioStepIds)[number];

export const scenarioSchema = z.object({
  purpose: z.string().min(1),
  code: z.literal(SYNTH_CODE),
  issuer: account,
  steps: z.array(z.object({
    id: z.enum(scenarioStepIds),
    status: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    flags: z.number().int().min(0).max(0x1ff),
  }).strict()).length(3),
}).strict().superRefine((s, ctx) => {
  s.steps.forEach((step, i) => {
    if ((step.status === 0) !== (step.flags === 0)) ctx.addIssue({ code: "custom", path: ["steps", i], message: "status 0 needs flags 0, and any other status needs flags (the feed rejects a mismatch)" });
  });
  const ids = s.steps.map((x) => x.id).join(",");
  if (ids !== scenarioStepIds.join(",")) ctx.addIssue({ code: "custom", path: ["steps"], message: `steps must be ${scenarioStepIds.join(", ")} in this order` });
});

export type Scenario = z.infer<typeof scenarioSchema>;

const describeIssues = (file: string, error: z.ZodError) =>
  `${file} is invalid: ${error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`;

export function parseDeployment(json: unknown): KeeperDeployment {
  const parsed = deploymentSchema.safeParse(json);
  if (!parsed.success) throw new Error(describeIssues("data/keeper/deployment.json", parsed.error));
  return parsed.data;
}

export function loadDeployment(file = DEPLOYMENT_FILE): KeeperDeployment {
  if (!fs.existsSync(file)) throw new Error("data/keeper/deployment.json does not exist; deploy the market first");
  return parseDeployment(JSON.parse(fs.readFileSync(file, "utf8")));
}

export type LoadedScenario = { scenario: Scenario; text: string; sha256: string };

export function parseScenario(text: string): LoadedScenario {
  const parsed = scenarioSchema.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error(describeIssues("data/keeper/scenario.json", parsed.error));
  return { scenario: parsed.data, text, sha256: createHash("sha256").update(text).digest("hex") };
}

export function loadScenario(file = SCENARIO_FILE): LoadedScenario {
  if (!fs.existsSync(file)) throw new Error("data/keeper/scenario.json does not exist");
  return parseScenario(fs.readFileSync(file, "utf8"));
}

/** The feed key of the synthetic asset: its Stellar Asset Contract ID on TESTNET. It names no real asset. */
export function syntheticKey(code: string, issuer: string): string {
  return new Asset(code, issuer).contractId(Networks.TESTNET);
}

/** `SHA-256(canonicalJson({scenario_sha256, step: id, as_of}))`, lowercase hex (spec 4.2). `as_of` is a JSON number of unix seconds. */
export function demoEvidenceHash(scenarioSha256: string, step: ScenarioStepId, asOf: bigint | number): string {
  return createHash("sha256").update(canonicalJson({ scenario_sha256: scenarioSha256, step, as_of: Number(asOf) })).digest("hex");
}

/** The part of an `assets.csv` row the checks use. */
export type UniverseRow = { asset_code: string; issuer: string; sac_contract_id: string };
/** The part of Recon's feed record the checks use (`data/feed/deployment.json`). */
export type ReconFeedRecord = { contract_id: string; admin: string; publisher: string };

/**
 * Cross-checks between the records, Recon's feed record and `data/assets.csv` (spec 4.2 and 4.3 step 1).
 * Returns one sentence per problem; an empty list means the records are consistent.
 */
export function checkRecords(dep: KeeperDeployment, scenario: Scenario, recon: ReconFeedRecord, universe: readonly UniverseRow[]): string[] {
  const problems: string[] = [];
  const { live, demo } = dep.markets;
  const writer = dep.demo_feed.writer;

  if (live.feed !== recon.contract_id) problems.push(`the live market's feed ${live.feed} is not Recon's feed ${recon.contract_id}`);
  for (const a of live.assets) {
    if (a.asset === null) {
      problems.push(`live asset ${a.label} has no CODE:ISSUER`);
      continue;
    }
    const [code, issuer] = a.asset.split(":");
    const row = universe.find((u) => u.asset_code === code && u.issuer === issuer);
    if (!row) problems.push(`live asset ${a.asset} is not in data/assets.csv`);
    else if (row.sac_contract_id !== a.key) problems.push(`live asset ${a.asset}: key ${a.key} is not the sac_contract_id ${row.sac_contract_id} in data/assets.csv`);
  }

  if (demo.feed !== dep.demo_feed.contract_id) problems.push(`the demo market's feed ${demo.feed} is not the demo feed ${dep.demo_feed.contract_id}`);
  if (demo.feed === recon.contract_id || dep.demo_feed.contract_id === recon.contract_id) problems.push("the demo feed is Recon's feed");
  if (scenario.issuer !== writer) problems.push(`scenario.json issuer ${scenario.issuer} is not the demo feed writer ${writer}`);
  const synth = syntheticKey(scenario.code, writer);
  if (demo.assets.length !== 1 || demo.assets[0].asset !== null || demo.assets[0].key !== synth) {
    problems.push(`the demo market must list exactly the synthetic key ${synth} with asset null`);
  }
  if (universe.some((u) => u.sac_contract_id === synth || u.asset_code === scenario.code)) problems.push(`the synthetic key ${synth} or code ${scenario.code} is in data/assets.csv`);

  const keys: [string, string][] = [
    ["lending-admin", dep.admin], ["lending-keeper", dep.keeper], ["lending-borrower", dep.borrower], ["demo-feed-writer", writer],
    ["Recon's publisher", recon.publisher], ["Recon's admin", recon.admin],
  ];
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      if (keys[i][1] === keys[j][1]) problems.push(`${keys[i][0]} and ${keys[j][0]} are the same account`);
    }
  }
  return problems;
}
