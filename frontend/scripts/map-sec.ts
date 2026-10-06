/**
 * Map each asset to its SEC fund share class, deterministically:
 * the issuer's stellar.toml `anchor_asset` (served from the pinned domain)
 * must equal a ticker in the SEC's company_tickers_mf.json.
 * Writes data/sec.csv. Needs SEC_CONTACT_EMAIL.
 *
 *   npm run map:sec
 */
import fs from "fs";
import path from "path";
import { fetchStellarToml, findCurrency } from "../lib/chain/toml";
import { loadUniverse } from "../lib/chain/universe";
import { EdgarClient, matchSecTicker, secUserAgent } from "../lib/documents/edgar";

const TICKERS_URL = "https://www.sec.gov/files/company_tickers_mf.json";
const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

async function main() {
  const userAgent = secUserAgent();
  if (!userAgent) {
    console.error("Set SEC_CONTACT_EMAIL in frontend/.env (the SEC requires a contact email in the User-Agent).");
    process.exit(1);
  }
  const edgar = new EdgarClient(userAgent);
  const index = JSON.parse(new TextDecoder().decode((await edgar.get(TICKERS_URL, 5_000_000)).bytes));
  const asOf = new Date().toISOString().slice(0, 10);

  const rows: string[][] = [];
  for (const asset of loadUniverse()) {
    try {
      const fetched = await fetchStellarToml(asset.home_domain);
      const anchor = findCurrency(fetched.toml, asset.issuer, asset.asset_code)?.anchor_asset;
      const ids = typeof anchor === "string" ? matchSecTicker(anchor, index) : null;
      if (!ids) {
        console.log(`${asset.asset_code.padEnd(8)} no SEC fund ticker (anchor_asset: ${typeof anchor === "string" ? anchor.slice(0, 40) : "-"})`);
        continue;
      }
      rows.push([
        asset.asset_code,
        asset.issuer,
        ids.ticker,
        ids.cik,
        ids.seriesId,
        ids.classId,
        `${fetched.finalUrl} anchor_asset=${anchor}; ${TICKERS_URL}`,
        asOf,
      ]);
      console.log(`${asset.asset_code.padEnd(8)} ${ids.ticker} cik=${ids.cik} series=${ids.seriesId} class=${ids.classId}`);
    } catch (err) {
      console.log(`${asset.asset_code.padEnd(8)} ERROR ${err instanceof Error ? err.message : err}`);
    }
  }

  const header = ["asset_code", "issuer", "ticker", "cik", "series_id", "class_id", "evidence", "as_of"];
  const out = path.join(process.cwd(), "..", "data", "sec.csv");
  fs.writeFileSync(out, [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n") + "\n");
  console.log(`\n${rows.length} assets mapped → data/sec.csv`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
