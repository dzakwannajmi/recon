/**
 * Run the chain checks for every asset in data/assets.csv and write
 * data/checks/YYYY-MM-DD.json. Read-only against Stellar mainnet.
 * One failing asset is recorded as an error and does not stop the run.
 *
 *   npm run check:assets
 */
import fs from "fs";
import path from "path";
import { getAssetFacts } from "../lib/chain/asset";
import { checkIssuerIdentity } from "../lib/chain/identity";
import { loadUniverse } from "../lib/chain/universe";

const DELAY_MS = 500; // be polite to Horizon, StellarExpert, and issuer sites

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const universe = loadUniverse();
  if (universe.length === 0) {
    console.error("data/assets.csv is missing or empty.");
    process.exit(1);
  }

  const checkedAt = new Date().toISOString();
  const results = [];
  let failed = 0;
  for (const [i, asset] of universe.entries()) {
    if (i > 0) await sleep(DELAY_MS);
    const label = asset.asset_code.padEnd(10);
    try {
      const [identity, facts] = await Promise.all([
        checkIssuerIdentity(asset.asset_code, asset.issuer, universe),
        getAssetFacts(asset.asset_code, asset.issuer),
      ]);
      results.push({ asset_code: asset.asset_code, issuer: asset.issuer, issuer_org: asset.issuer_org, identity, facts });
      console.log(`${label} ${identity.status.padEnd(20)} trustlines=${facts.authorizedTrustlines ?? "-"} funded=${facts.fundedHolders ?? "-"}`);
    } catch (err) {
      failed++;
      const error = err instanceof Error ? err.message : String(err);
      results.push({ asset_code: asset.asset_code, issuer: asset.issuer, issuer_org: asset.issuer_org, error });
      console.log(`${label} ERROR ${error}`);
    }
  }

  const outDir = path.join(process.cwd(), "..", "data", "checks");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${checkedAt.slice(0, 10)}.json`);
  fs.writeFileSync(outFile, JSON.stringify({ checked_at: checkedAt, results }, null, 2) + "\n");
  console.log(`\n${results.length} assets checked (${failed} errors) → ${path.relative(path.join(process.cwd(), ".."), outFile)}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
