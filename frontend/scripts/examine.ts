/**
 * Examiner v1: compare each asset's on-chain supply with what its documents
 * state, and investigate every mismatch. Read-only (Horizon); no LLM.
 *
 *   npm run examine
 *
 * Writes (together, at the end of the run):
 *   data/claims/sources.json            facts read by code from SEC filings and stellar.toml supply fields
 *   data/examinations/YYYY-MM-DD.json   checks, investigations, patterns, errors, and the run's limits
 */
import fs from "fs";
import path from "path";
import { formatStroops, getAssetFacts, totalSupply } from "../lib/chain/asset";
import { fetchUntrustedBytes } from "../lib/chain/http";
import { listIssuers } from "../lib/chain/horizon";
import { checkIssuerIdentity } from "../lib/chain/identity";
import { MAX_TOML_BYTES, sameSiteWww, stellarTomlUrl } from "../lib/chain/toml";
import { loadUniverse, parseCsv } from "../lib/chain/universe";
import { EXTRACTOR_VERSION } from "../lib/documents/extract";
import { SnapshotStore, assetKey, currentRecords } from "../lib/documents/store";
import { ClaimStore, type Claim } from "../lib/claims/store";
import { checkFiledShares, checkMaxIssuance, checkTomlFixedNumber, checkTomlMaxNumber, type CheckResult, type Reference } from "../lib/examine/checks";
import { investigateIdentityMismatch, investigateSupplyMismatch, lineStats, orgName, type Investigation } from "../lib/examine/investigate";
import { parseNmfp3, parseNport, tomlSupplyFields, type SourceFact, type StoredSourceFact } from "../lib/examine/sources";

const DATA = path.join(process.cwd(), "..", "data");
const DELAY_MS = 400;
/** Issuers sharing a pinned code that are investigated per code, and in total (bounded). */
const IDENTITY_PER_CODE = 2;
const IDENTITY_TOTAL = 12;
const ISSUERS_SCANNED = 6;
/**
 * Codes that are invented for one product (brand names), so another issuer
 * using one is worth a look on its own. Every other code (ordinary words and
 * common tickers such as GOLD, TIPS, SPXU) is only investigated when the
 * issuer's toml or domain points at the pinned organization.
 */
const DISTINCTIVE_CODES = new Set([
  "BENJI", "gBENJI", "grBENJI", "sgBENJI", "USDY", "USTRY", "TESOURO", "YLDS", "BB1", "WTGX", "WTSY", "WTTS", "WTST", "WTLG", "WTSI", "FLTT",
]);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

type SecRow = { asset_code: string; issuer: string; cik: string; series_id: string; class_id: string };

function loadSecMap(): SecRow[] {
  const file = path.join(DATA, "sec.csv");
  if (!fs.existsSync(file)) return [];
  const [header, ...rows] = parseCsv(fs.readFileSync(file, "utf8"));
  return rows.map((cells) => Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""])) as SecRow);
}

function writeJson(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

/** Code-derived facts from the current filings and tomls; each quote is checked at its exact offset in the bytes. */
function readSourceFacts(snapshots: SnapshotStore, secMap: SecRow[]): StoredSourceFact[] {
  const facts: StoredSourceFact[] = [];
  for (const record of currentRecords(snapshots.all())) {
    if (record.sourceClass !== "regulatory_filing" && record.sourceClass !== "issuer_toml") continue;
    if (!snapshots.verifyBlob(record.sha256)) {
      console.log(`skip (blob does not match its hash) ${record.url}`);
      continue;
    }
    const text = fs.readFileSync(path.join(snapshots.dir, "blobs", record.sha256), "utf8");
    for (const asset of record.assets) {
      const [code, issuer] = asset.split(":");
      let found: SourceFact[] | null = null;
      let label = `${new URL(record.finalUrl).hostname.replace(/^www\./, "")} stellar.toml`;
      if (record.sourceClass === "regulatory_filing" && record.filing) {
        const sec = secMap.find((r) => r.asset_code === code && r.issuer === issuer);
        if (!sec) continue;
        found = record.filing.form.startsWith("N-MFP") ? parseNmfp3(text, sec.class_id) : parseNport(text, sec.series_id);
        label = `SEC ${record.filing.form} filed ${record.filing.filedAt}`;
      } else {
        found = tomlSupplyFields(text, code, issuer);
      }
      for (const fact of found ?? []) {
        if (text.slice(fact.offset, fact.offset + fact.quote.length) !== fact.quote) continue; // golden rule 2, at the exact place
        facts.push({ ...fact, asset, source_url: record.url, source_class: record.sourceClass, snapshot_sha256: record.sha256, field_source: "code", label });
      }
    }
  }
  return facts;
}

const refFromSource = (f: StoredSourceFact): Reference => ({
  kind: f.source_class === "regulatory_filing" ? "filing" : "toml",
  label: f.label, value: f.value as number, unit: f.unit, as_of: f.as_of, source_url: f.source_url, quote: f.quote, where: f.section, snapshot_sha256: f.snapshot_sha256,
});

const refFromClaim = (c: Claim): Reference => ({
  kind: "claim", label: `issuer document ${c.source_url}`, value: c.value as number, unit: c.unit, as_of: c.as_of, source_url: c.source_url, quote: c.quote,
  where: c.page ? `page ${c.page}` : null, snapshot_sha256: c.snapshot_sha256,
});

/** The second-level label of a domain ("franklintempleton" for www.franklintempleton.com). */
const brand = (domain: string) => domain.replace(/^www\./, "").split(".").slice(-2)[0];

async function main() {
  const universe = loadUniverse();
  if (universe.length === 0) {
    console.error("data/assets.csv is missing or empty.");
    process.exit(1);
  }
  const snapshots = new SnapshotStore();
  const claims = new ClaimStore().claims;
  const sources = readSourceFacts(snapshots, loadSecMap());

  const checkedAt = new Date().toISOString();
  const checks: CheckResult[] = [];
  const investigations: Investigation[] = [];
  const errors: { asset: string; step: string; error: string }[] = [];
  const limits: string[] = [];

  for (const [i, a] of universe.entries()) {
    const asset = assetKey(a.asset_code, a.issuer);
    const mine = sources.filter((f) => f.asset === asset);
    const myClaims = claims.filter((c) => c.asset === asset && typeof c.value === "number");
    if (mine.length === 0 && !myClaims.some((c) => c.field === "max_issuance")) continue;
    if (i > 0) await sleep(DELAY_MS);

    let facts;
    try {
      facts = await getAssetFacts(a.asset_code, a.issuer);
    } catch (err) {
      errors.push({ asset, step: "asset_facts", error: errorText(err) });
      console.log(`${a.asset_code.padEnd(8)} error reading Horizon (${errorText(err)})`);
      continue;
    }
    if (!facts.exists || !facts.supply) {
      errors.push({ asset, step: "asset_facts", error: "asset not found on Horizon" });
      continue;
    }
    const supply = facts.supply;
    const ratios = myClaims.filter((c) => c.field === "token_unit_ratio").map(refFromClaim);
    const results: CheckResult[] = [];
    for (const f of mine.filter((f) => f.field === "toml_fixed_number")) results.push(checkTomlFixedNumber(asset, supply, facts.checkedAt, refFromSource(f)));
    for (const f of mine.filter((f) => f.field === "toml_max_number")) results.push(checkTomlMaxNumber(asset, supply, facts.checkedAt, refFromSource(f)));
    for (const f of mine.filter((f) => f.field === "units_outstanding")) results.push(checkFiledShares(asset, supply, facts.checkedAt, refFromSource(f), ratios));
    for (const c of myClaims.filter((c) => c.field === "max_issuance")) {
      const sameUnitRatio = myClaims.find((r) => r.field === "token_unit_ratio" && r.unit === c.unit);
      results.push(checkMaxIssuance(asset, supply, facts.checkedAt, refFromClaim(c), sameUnitRatio ? refFromClaim(sameUnitRatio) : null));
    }

    for (const r of results) {
      checks.push(r);
      console.log(`${a.asset_code.padEnd(8)} ${r.check.padEnd(28)} ${r.status.padEnd(15)} ${r.statement}`);
      if (r.status !== "mismatch" || !r.reference || !r.threshold_tokens) continue;
      try {
        const inv = await investigateSupplyMismatch({
          asset, check: r.check, supply, breakdown: facts.supplyBreakdown, reference: { label: r.reference.label, tokens: r.threshold_tokens },
        });
        investigations.push(inv);
        console.log(`         investigation: ${inv.conclusion}`);
      } catch (err) {
        errors.push({ asset, step: `investigate:${r.check}`, error: errorText(err) });
        console.log(`         investigation error (${errorText(err)})`);
      }
    }
  }

  // Issuers that share a pinned asset's code without verifying against its domain.
  const fetchToml = async (domain: string) => {
    try {
      const { bytes, contentType, finalUrl } = await fetchUntrustedBytes(stellarTomlUrl(domain), { maxBytes: MAX_TOML_BYTES, allowRedirect: sameSiteWww });
      return { bytes, contentType, finalUrl, text: new TextDecoder().decode(bytes) };
    } catch {
      return null;
    }
  };
  let identityCount = 0;
  const skippedCodes: string[] = [];
  for (const code of [...new Set(universe.map((a) => a.asset_code))]) {
    if (identityCount >= IDENTITY_TOTAL) {
      skippedCodes.push(code);
      continue;
    }
    const pinned = universe.filter((a) => a.asset_code === code);
    const official = pinned[0];
    const officialRecord = snapshots.all().find((r) => r.sourceClass === "issuer_toml" && r.assets.includes(assetKey(official.asset_code, official.issuer)));
    const officialText = officialRecord ? snapshots.readText(officialRecord.sha256) : null;
    const officialToml = officialRecord && officialText ? { url: officialRecord.url, text: officialText, sha256: officialRecord.sha256 } : null;
    const officialOrg = (officialText && orgName(officialText)) || official.issuer_org;

    let records;
    try {
      await sleep(DELAY_MS);
      records = (await listIssuers(code)).records;
    } catch (err) {
      errors.push({ asset: code, step: "list_issuers", error: errorText(err) });
      continue;
    }
    let done = 0;
    for (const rec of records.filter((r) => !pinned.some((p) => p.issuer === r.asset_issuer)).slice(0, ISSUERS_SCANNED)) {
      if (done >= IDENTITY_PER_CODE || identityCount >= IDENTITY_TOTAL) break;
      const asset = assetKey(code, rec.asset_issuer);
      try {
        const id = await checkIssuerIdentity(code, rec.asset_issuer, universe);
        if (id.status === "verified" || !id.homeDomain) continue;
        const fetched = await fetchToml(id.homeDomain);
        if (!DISTINCTIVE_CODES.has(code)) {
          // A common code: only look further when the issuer points at the pinned organization.
          const sameOrg = Boolean(fetched && orgName(fetched.text) === officialOrg);
          const stats = fetched && officialToml ? lineStats(fetched.text, officialToml.text) : null;
          const copied = Boolean(stats && stats.ratio >= 0.5 && stats.shared >= 3);
          const similarDomain = id.homeDomain.includes(brand(official.official_domain));
          if (!sameOrg && !copied && !similarDomain) continue;
        }
        let toml: { url: string; text: string; sha256: string } | null = null;
        if (fetched) {
          // If these bytes are already stored (e.g. this home_domain is the pinned issuer's own domain),
          // reuse that snapshot; save() never attaches this issuer to another class's record.
          const record = snapshots.save({
            bytes: fetched.bytes, url: stellarTomlUrl(id.homeDomain), finalUrl: fetched.finalUrl, contentType: fetched.contentType,
            sourceClass: "third_party_toml", asset, discoveredFrom: null, text: { kind: "text", value: fetched.text, pages: null }, extractor: EXTRACTOR_VERSION,
            now: checkedAt,
          });
          toml = { url: fetched.finalUrl, text: fetched.text, sha256: record.sha256 };
        }
        const inv = await investigateIdentityMismatch({
          code, issuer: rec.asset_issuer, status: id.status, homeDomain: id.homeDomain,
          pinned: { issuer: official.issuer, org: officialOrg, domain: official.official_domain },
          trustlines: rec.accounts.authorized, supply: formatStroops(totalSupply(rec).total), toml, officialToml,
        });
        investigations.push(inv);
        done++;
        identityCount++;
        console.log(`${code.padEnd(8)} issuer_identity              ${id.status.padEnd(15)} ${inv.conclusion}`);
      } catch (err) {
        errors.push({ asset, step: "investigate:issuer_identity", error: errorText(err) });
      }
    }
  }
  if (skippedCodes.length) limits.push(`The identity scan stopped at ${IDENTITY_TOTAL} investigations; codes not scanned: ${skippedCodes.join(", ")}.`);
  limits.push(
    `For each code, up to ${ISSUERS_SCANNED} other issuers (most trustlines first) were checked, and up to ${IDENTITY_PER_CODE} investigated. Only brand-specific codes (${[...DISTINCTIVE_CODES].join(", ")}) were investigated without further signals; other codes only when the issuer's toml (same ORG_NAME or at least half its lines) or domain points at the pinned organization.`,
  );

  // Facts across investigations: one account funding several of these issuer accounts.
  const byFunder = new Map<string, string[]>();
  for (const inv of investigations) {
    const funder = (inv.steps.find((st) => st.step === "account_origin")?.data as { funder?: string } | undefined)?.funder;
    if (funder) byFunder.set(funder, [...(byFunder.get(funder) ?? []), inv.asset]);
  }
  const patterns = [...byFunder]
    .map(([funder, assets]) => ({ funder, accounts: [...new Set(assets.map((a) => a.split(":")[1]))], codes: [...new Set(assets.map((a) => a.split(":")[0]))] }))
    .filter((g) => g.accounts.length > 1)
    .map((g) => ({
      pattern: "shared_funder",
      funder: g.funder,
      issuer_accounts: g.accounts,
      codes: g.codes,
      statement: `Account ${g.funder} created ${g.accounts.length} of the investigated issuer accounts (${g.accounts.join(", ")}), which issue ${g.codes.join(", ")}.`,
    }));
  for (const p of patterns) console.log(`pattern  ${p.statement}`);

  // Third-party tomls not seen in this run belong to earlier runs' investigations.
  const stale = snapshots.remove((r) => r.sourceClass === "third_party_toml" && r.lastSeenAt < checkedAt);
  if (stale) console.log(`removed ${stale} third-party toml records from earlier runs`);
  snapshots.flush();
  writeJson(path.join(DATA, "claims", "sources.json"), sources);
  const outFile = path.join(DATA, "examinations", `${checkedAt.slice(0, 10)}.json`);
  writeJson(outFile, { checked_at: checkedAt, checks, investigations, patterns, errors, limits });
  const count = (s: string) => checks.filter((c) => c.status === s).length;
  console.log(
    `\n${sources.length} code-read facts. ${checks.length} checks: ${count("consistent")} consistent, ${count("mismatch")} mismatch, ${count("not_comparable")} not comparable; ` +
      `${investigations.length} investigations; ${errors.length} errors → ${path.relative(DATA, outFile)}`,
  );
}

main().catch((err) => {
  console.error(errorText(err));
  process.exit(1);
});
