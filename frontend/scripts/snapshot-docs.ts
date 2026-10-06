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
import { fetchUntrustedBytes } from "../lib/chain/http";
import { findCurrency, parseStellarToml, sameSiteWww, stellarTomlUrl, tomlListsAccount, MAX_TOML_BYTES } from "../lib/chain/toml";
import { loadUniverse, parseCsv, type UniverseAsset } from "../lib/chain/universe";
import { isOnOfficialDomain, issuerRedirectPolicy, pickDocumentLinks, seedsFor, tomlDocumentUrls } from "../lib/documents/discover";
import { EdgarClient, primaryXmlUrl, secUserAgent } from "../lib/documents/edgar";
import { EXTRACTOR_VERSION, extractText } from "../lib/documents/extract";
import { assetKey, SnapshotStore, type SnapshotRecord, type SourceClass } from "../lib/documents/store";

const MAX_DOC_BYTES = 20_000_000;
const DELAY_MS = 300;
/** HTML with less visible text than this is most likely a JavaScript shell. */
const MIN_HTML_CHARS = 1500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

type SecRow = { asset_code: string; issuer: string; cik: string; series_id: string };

function loadSecMap(): SecRow[] {
  const file = path.join(process.cwd(), "..", "data", "sec.csv");
  if (!fs.existsSync(file)) return [];
  const [header, ...rows] = parseCsv(fs.readFileSync(file, "utf8"));
  return rows.map((cells) => Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""])) as SecRow);
}

/** A snapshot counts toward coverage if it carries real document text. */
function isUseful(r: SnapshotRecord) {
  return r.sourceClass !== "issuer_toml" && r.text !== null && (r.text.kind !== "html" || r.text.chars >= MIN_HTML_CHARS);
}

/** One fetch per (official domain, url) per run; `links` are the document links found on an official page. */
type Visit = { record: SnapshotRecord | null; links: string[] };

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
  const visits = new Map<string, Visit>();
  const now = new Date().toISOString();

  /** Fetch and store one issuer URL (once per run), crediting the asset, and return its document links. */
  async function visit(asset: UniverseAsset, url: string, discoveredFrom: string | null, followLinks: boolean): Promise<Visit> {
    const key = assetKey(asset.asset_code, asset.issuer);
    const cacheKey = `${asset.official_domain} ${url}`;
    const cached = visits.get(cacheKey);
    if (cached) {
      if (cached.record && !cached.record.assets.includes(key)) cached.record.assets.push(key);
      return cached;
    }
    const result: Visit = { record: null, links: [] };
    visits.set(cacheKey, result);
    await sleep(DELAY_MS);
    try {
      const { bytes, contentType, finalUrl } = await fetchUntrustedBytes(url, {
        maxBytes: MAX_DOC_BYTES,
        timeoutMs: 30_000,
        allowRedirect: issuerRedirectPolicy(asset.official_domain),
      });
      const text = await extractText(bytes, contentType);
      if (!text) {
        console.log(`    skip (unsupported type ${contentType || "?"}) ${url}`);
        return result;
      }
      result.record = store.save({ bytes, url, finalUrl, contentType, sourceClass: "issuer", asset: key, discoveredFrom, text, extractor: EXTRACTOR_VERSION, now });
      const note = text.kind === "html" && text.value.length < MIN_HTML_CHARS ? " (little text: needs a browser)" : "";
      console.log(`    ${text.kind.padEnd(4)} ${String(text.pages ?? "-").padStart(3)}p ${String(text.value.length).padStart(7)}ch ${result.record.sha256.slice(0, 12)} ${url}${note}`);
      // Links are resolved against the URL the page was actually served from.
      if (followLinks && text.kind === "html" && isOnOfficialDomain(finalUrl, asset.official_domain)) {
        result.links = pickDocumentLinks(new TextDecoder().decode(bytes), finalUrl, asset.official_domain);
      }
    } catch (err) {
      console.log(`    error (${errorText(err)}) ${url}`);
    }
    return result;
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
      store.save({
        bytes, url: tomlSource, finalUrl, contentType, sourceClass: "issuer_toml", asset: key, discoveredFrom: null,
        text: { kind: "text", value: textValue, pages: null }, extractor: EXTRACTOR_VERSION, now,
      });
      const { toml } = parseStellarToml(textValue);
      if (tomlListsAccount(toml, asset.issuer)) {
        tomlUrl = finalUrl;
        tomlUrls = tomlDocumentUrls(toml, findCurrency(toml, asset.issuer, asset.asset_code));
      } else {
        console.log("    the toml no longer lists this issuer: its links are not used as issuer sources");
      }
    } catch (err) {
      console.log(`    toml error (${errorText(err)})`);
    }

    // 2. issuer documents
    const pinnedUrls = asset.docs_urls.split(";").map((u) => u.trim()).filter(Boolean);
    const { seeds, rejected } = seedsFor({ officialDomain: asset.official_domain, tomlUrl, tomlUrls, pinnedUrls });
    for (const url of rejected) console.log(`    pinned URL not on the official domain, not a seed: ${url}`);
    for (const seed of seeds) {
      const page = await visit(asset, seed.url, seed.discoveredFrom, true);
      const from = page.record?.finalUrl ?? seed.url;
      for (const link of page.links) await visit(asset, link, from, false);
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
            bytes, url, finalUrl, contentType, sourceClass: "regulatory_filing", asset: key, discoveredFrom: filing.indexUrl, text,
            extractor: EXTRACTOR_VERSION, now,
            filing: { cik: sec.cik, seriesId: sec.series_id, form: filing.form, accession: filing.accession, filedAt: filing.filedAt },
          });
          console.log(`    sec  ${filing.form} filed ${filing.filedAt} ${record.sha256.slice(0, 12)} ${url}`);
        }
      } catch (err) {
        console.log(`    sec error (${errorText(err)})`);
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
  console.error(errorText(err));
  process.exit(1);
});
