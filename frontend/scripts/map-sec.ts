/**
 * Map each asset to its SEC fund share class, deterministically:
 * the issuer's stellar.toml `anchor_asset` (served from the pinned domain)
 * must equal a fund ticker in the SEC's company_tickers_mf.json.
 * Writes data/sec.csv. Needs SEC_CONTACT_EMAIL. If one asset's toml can't be
 * read this run, its previous row is kept.
 *
 *   npm run map:sec
 */
import fs from "fs";
import path from "path";
import { fetchStellarToml, findCurrency } from "../lib/chain/toml";
import { loadUniverse, parseCsv } from "../lib/chain/universe";
import { EdgarClient, matchSecTicker, secUserAgent } from "../lib/documents/edgar";

const TICKERS_URL = "https://www.sec.gov/files/company_tickers_mf.json";
const HEADER = ["asset_code", "issuer", "ticker", "cik", "series_id", "class_id", "evidence", "as_of"];
const OUT = path.join(process.cwd(), "..", "data", "sec.csv");
const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

function previousRows(): string[][] {
  if (!fs.existsSync(OUT)) return [];
  const [header, ...rows] = parseCsv(fs.readFileSync(OUT, "utf8"));
  return header?.join(",") === HEADER.join(",") ? rows : [];
}

async function main() {
  const userAgent = secUserAgent();
  if (!userAgent) {
    console.error("Set SEC_CONTACT_EMAIL in frontend/.env (the SEC requires a contact email in the User-Agent).");
    process.exit(1);
  }
  const edgar = new EdgarClient(userAgent);
  const index = JSON.parse(new TextDecoder().decode((await edgar.get(TICKERS_URL, 5_000_000)).bytes));
  const asOf = new Date().toISOString().slice(0, 10);
  const previous = previousRows();

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
      const evidence = `${fetched.finalUrl} (sha256 ${fetched.sha256}) anchor_asset=${anchor}; ${TICKERS_URL}`;
      rows.push([asset.asset_code, asset.issuer, ids.ticker, ids.cik, ids.seriesId, ids.classId, evidence, asOf]);
      console.log(`${asset.asset_code.padEnd(8)} ${ids.ticker} cik=${ids.cik} series=${ids.seriesId} class=${ids.classId}`);
    } catch (err) {
      const kept = previous.find((r) => r[0] === asset.asset_code && r[1] === asset.issuer);
      if (kept) rows.push(kept);
      console.log(`${asset.asset_code.padEnd(8)} ERROR ${err instanceof Error ? err.message : err}${kept ? " (kept the previous row)" : ""}`);
    }
  }

  const tmp = `${OUT}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, [HEADER, ...rows].map((r) => r.map(csvCell).join(",")).join("\n") + "\n");
  fs.renameSync(tmp, OUT);
  console.log(`\n${rows.length} assets mapped → data/sec.csv`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
