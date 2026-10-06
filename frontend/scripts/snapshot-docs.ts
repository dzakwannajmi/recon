/**
 * Snapshot issuer documents and SEC filings for every asset in data/assets.csv.
 * Read-only. Writes bytes and text under data/snapshots/ and updates
 * data/snapshots/index.json.
 *
 *   npm run snapshot:docs
 *
 * Per asset:
 * 1. the issuer's stellar.toml (source class `issuer_toml`)
 * 2. issuer documents: URLs in the toml, pinned docs_urls on the official
 *    domain, and document links one hop from official pages (`issuer`)
 * 3. the latest SEC fund report from data/sec.csv, if SEC_CONTACT_EMAIL is set (`regulatory_filing`)
 */
import fs from "fs";
import path from "path";
import { fetchUntrustedBytes, isSameOrSubdomain } from "../lib/chain/http";
import { findCurrency, parseStellarToml, sameSiteWww, stellarTomlUrl, MAX_TOML_BYTES } from "../lib/chain/toml";
import { loadUniverse, parseCsv, type UniverseAsset } from "../lib/chain/universe";
import { isOnOfficialDomain, pickDocumentLinks, seedsFor, tomlDocumentUrls } from "../lib/documents/discover";
import { EdgarClient, primaryXmlUrl, secUserAgent } from "../lib/documents/edgar";
import { extractText } from "../lib/documents/extract";
import { assetKey, SnapshotStore, type SnapshotRecord, type SourceClass } from "../lib/documents/store";

const MAX_DOC_BYTES = 20_000_000;
const DELAY_MS = 300;
/** HTML with less visible text than this is most likely a JavaScript shell. */
const MIN_HTML_CHARS = 1500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type SecRow = { asset_code: string; issuer: string; cik: string; series_id: string };

function loadSecMap(): SecRow[] {
  const file = path.join(process.cwd(), "..", "data", "sec.csv");
  if (!fs.existsSync(file)) return [];
  const [header, ...rows] = parseCsv(fs.readFileSync(file, "utf8"));
  return rows.map((cells) => Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""])) as SecRow);
}

/** A snapshot counts toward coverage if it carries real document text. */
export function isUseful(r: SnapshotRecord) {
  return r.sourceClass !== "issuer_toml" && r.text !== null && (r.text.kind !== "html" || r.text.chars >= MIN_HTML_CHARS);
}

async function main() {
  const universe = loadUniverse();
  if (universe.length === 0) {
    console.error("data/assets.csv is missing or empty.");
    process.exit(1);
  }
  const store = new SnapshotStore();
  const userAgent = secUserAgent();
  const edgar = userAgent ? new EdgarClient(userAgent) : null;
  if (!edgar) console.warn("SEC_CONTACT_EMAIL is not set: skipping SEC filings.\n");
  const secMap = loadSecMap();
  const seen = new Map<string, SnapshotRecord | null>(); // url → record, once per run
  const now = new Date().toISOString();

  async function snapshot(asset: UniverseAsset, url: string, discoveredFrom: string | null, sourceClass: SourceClass) {
    const key = assetKey(asset.asset_code, asset.issuer);
    if (seen.has(url)) {
      const record = seen.get(url);
      if (record && !record.assets.includes(key)) record.assets.push(key);
      return { record: record ?? null, html: null as string | null };
    }
    await sleep(DELAY_MS);
    try {
      const { bytes, contentType, finalUrl } = await fetchUntrustedBytes(url, {
        maxBytes: MAX_DOC_BYTES,
        timeoutMs: 30_000,
        allowRedirect: (from, to) => sameSiteWww(from, to) || isSameOrSubdomain(to, asset.official_domain),
      });
      const text = await extractText(bytes, contentType);
      if (!text) {
        console.log(`    skip (unsupported type ${contentType || "?"}) ${url}`);
        seen.set(url, null);
        return { record: null, html: null };
      }
      const record = store.save({ bytes, url, finalUrl, contentType, sourceClass, asset: key, discoveredFrom, text, now });
      seen.set(url, record);
      const note = text.kind === "html" && text.value.length < MIN_HTML_CHARS ? " (little text: needs a browser)" : "";
      console.log(`    ${text.kind.padEnd(4)} ${String(text.pages ?? "-").padStart(3)}p ${String(text.value.length).padStart(7)}ch ${record.sha256.slice(0, 12)} ${url}${note}`);
      return { record, html: text.kind === "html" ? new TextDecoder().decode(bytes) : null };
    } catch (err) {
      console.log(`    error (${err instanceof Error ? err.message : err}) ${url}`);
      seen.set(url, null);
      return { record: null, html: null };
    }
  }

  for (const asset of universe) {
    const key = assetKey(asset.asset_code, asset.issuer);
    console.log(`${asset.asset_code} (${asset.issuer_org})`);

    // 1. stellar.toml, exact bytes
    let tomlUrl: string | null = null;
    let tomlUrls: string[] = [];
    const tomlSource = stellarTomlUrl(asset.home_domain);
    try {
      const { bytes, contentType, finalUrl } = await fetchUntrustedBytes(tomlSource, { maxBytes: MAX_TOML_BYTES, allowRedirect: sameSiteWww });
      const textValue = new TextDecoder().decode(bytes);
      store.save({ bytes, url: tomlSource, finalUrl, contentType, sourceClass: "issuer_toml", asset: key, discoveredFrom: null, text: { kind: "text", value: textValue, pages: null }, now });
      const { toml } = parseStellarToml(textValue);
      tomlUrl = finalUrl;
      tomlUrls = tomlDocumentUrls(toml, findCurrency(toml, asset.issuer, asset.asset_code));
    } catch (err) {
      console.log(`    toml error (${err instanceof Error ? err.message : err})`);
    }

    // 2. issuer documents
    const pinnedUrls = asset.docs_urls.split(";").map((u) => u.trim()).filter(Boolean);
    const { seeds, rejected } = seedsFor({ officialDomain: asset.official_domain, tomlUrl, tomlUrls, pinnedUrls });
    for (const url of rejected) console.log(`    not on the official domain, skipped: ${url}`);
    for (const seed of seeds) {
      const { html } = await snapshot(asset, seed.url, seed.discoveredFrom, "issuer");
      if (html && isOnOfficialDomain(seed.url, asset.official_domain)) {
        for (const link of pickDocumentLinks(html, seed.url, asset.official_domain)) await snapshot(asset, link, seed.url, "issuer");
      }
    }

    // 3. latest SEC fund report
    const sec = secMap.find((r) => r.asset_code === asset.asset_code && r.issuer === asset.issuer);
    if (sec && edgar) {
      try {
        const filing = await edgar.latestFundReport(sec.series_id);
        if (!filing) {
          console.log(`    no N-MFP3 or NPORT-P filing for series ${sec.series_id}`);
        } else {
          const url = primaryXmlUrl(sec.cik, filing.accession);
          const { bytes, contentType, finalUrl } = await edgar.get(url);
          const text = await extractText(bytes, contentType || "application/xml");
          const record = store.save({
            bytes, url, finalUrl, contentType, sourceClass: "regulatory_filing", asset: key, discoveredFrom: filing.indexUrl, text, now,
            filing: { cik: sec.cik, seriesId: sec.series_id, form: filing.form, accession: filing.accession, filedAt: filing.filedAt },
          });
          console.log(`    sec  ${filing.form} filed ${filing.filedAt} ${record.sha256.slice(0, 12)} ${url}`);
        }
      } catch (err) {
        console.log(`    sec error (${err instanceof Error ? err.message : err})`);
      }
    }
  }

  store.flush();
  const records = store.all().filter((r) => r.lastSeenAt === now);
  const covered = universe.filter((a) => records.some((r) => isUseful(r) && r.assets.includes(assetKey(a.asset_code, a.issuer))));
  const byClass = (c: SourceClass) => records.filter((r) => r.sourceClass === c).length;
  console.log(
    `\n${records.length} snapshots this run (issuer_toml ${byClass("issuer_toml")}, issuer ${byClass("issuer")}, regulatory_filing ${byClass("regulatory_filing")}).`,
  );
  console.log(`${covered.length}/${universe.length} assets have at least one document with real text (not counting the toml).`);
  const missing = universe.filter((a) => !covered.includes(a)).map((a) => a.asset_code);
  if (missing.length) console.log(`No document yet: ${missing.join(", ")}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
