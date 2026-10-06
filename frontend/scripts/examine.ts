/**
 * Examiner v1: compare each asset's on-chain supply with what its documents
 * state, and investigate every mismatch. Read-only (Horizon); no LLM.
 *
 *   npm run examine
 *
 * Writes:
 *   data/claims/sources.json            facts read by code from SEC filings and stellar.toml supply fields
 *   data/examinations/YYYY-MM-DD.json   checks (consistent / mismatch / not_comparable) and investigations
 */
import fs from "fs";
import path from "path";
import { createHash } from "node:crypto";
import { getAssetFacts } from "../lib/chain/asset";
import { fetchUntrustedBytes } from "../lib/chain/http";
import { listIssuers } from "../lib/chain/horizon";
import { checkIssuerIdentity } from "../lib/chain/identity";
import { MAX_TOML_BYTES, sameSiteWww, stellarTomlUrl } from "../lib/chain/toml";
import { loadUniverse, parseCsv } from "../lib/chain/universe";
import { SnapshotStore, type SnapshotRecord } from "../lib/documents/store";
import { ClaimStore, type Claim } from "../lib/claims/store";
import { checkFiledShares, checkMaxIssuance, checkTomlFixedNumber, checkTomlMaxNumber, type CheckResult, type Reference } from "../lib/examine/checks";
import { investigateIdentityMismatch, investigateSupplyMismatch, type Investigation } from "../lib/examine/investigate";
import { parseNmfp3, parseNport, tomlSupplyFields, type SourceFact } from "../lib/examine/sources";

const DATA = path.join(process.cwd(), "..", "data");
const DELAY_MS = 400;
/** Lookalike issuers investigated per asset code, and in total (bounded). */
const IDENTITY_PER_CODE = 2;
const IDENTITY_TOTAL = 12;
const ISSUERS_SCANNED = 6;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type SecRow = { asset_code: string; issuer: string; cik: string; series_id: string; class_id: string };
export type StoredSourceFact = SourceFact & { asset: string; source_url: string; source_class: string; snapshot_sha256: string; field_source: "code"; label: string };

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

/** Read code-derived facts from every filing and toml snapshot; each quote is re-checked against the exact bytes. */
function readSourceFacts(snapshots: SnapshotStore, secMap: SecRow[]): StoredSourceFact[] {
  const facts: StoredSourceFact[] = [];
  const bytesOf = (r: SnapshotRecord) => fs.readFileSync(path.join(snapshots.dir, "blobs", r.sha256), "utf8");
  for (const record of snapshots.all()) {
    if (record.sourceClass !== "regulatory_filing" && record.sourceClass !== "issuer_toml") continue;
    if (!snapshots.verifyBlob(record.sha256)) {
      console.log(`skip (blob does not match its hash) ${record.url}`);
      continue;
    }
    const text = bytesOf(record);
    for (const asset of record.assets) {
      const [code, issuer] = asset.split(":");
      let found: SourceFact[] | null = null;
      let label = "stellar.toml";
      if (record.sourceClass === "regulatory_filing" && record.filing) {
        const sec = secMap.find((r) => r.asset_code === code && r.issuer === issuer);
        if (!sec) continue;
        found = record.filing.form.startsWith("N-MFP") ? parseNmfp3(text, sec.class_id) : parseNport(text, sec.series_id);
        label = `SEC ${record.filing.form} filed ${record.filing.filedAt}`;
      } else if (record.sourceClass === "issuer_toml") {
        found = tomlSupplyFields(text, code, issuer);
      }
      for (const fact of found ?? []) {
        if (!text.includes(fact.quote)) continue; // golden rule 2: the quote must be in the exact bytes
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

async function main() {
  const universe = loadUniverse();
  if (universe.length === 0) {
    console.error("data/assets.csv is missing or empty.");
    process.exit(1);
  }
  const snapshots = new SnapshotStore();
  const claims = new ClaimStore().claims;
  const sources = readSourceFacts(snapshots, loadSecMap());
  writeJson(path.join(DATA, "claims", "sources.json"), sources);

  const checkedAt = new Date().toISOString();
  const checks: CheckResult[] = [];
  const investigations: Investigation[] = [];

  for (const [i, a] of universe.entries()) {
    if (i > 0) await sleep(DELAY_MS);
    const asset = `${a.asset_code}:${a.issuer}`;
    const mine = sources.filter((f) => f.asset === asset);
    const myClaims = claims.filter((c) => c.asset === asset);
    if (mine.length === 0 && !myClaims.some((c) => c.field === "max_issuance")) continue;

    const facts = await getAssetFacts(a.asset_code, a.issuer);
    if (!facts.exists || !facts.supply) {
      console.log(`${a.asset_code.padEnd(8)} asset not found on Horizon`);
      continue;
    }
    const supply = facts.supply;
    const ratio = myClaims.find((c) => c.field === "token_unit_ratio" && typeof c.value === "number");
    const results: CheckResult[] = [];

    for (const f of mine.filter((f) => f.field === "toml_fixed_number")) results.push(checkTomlFixedNumber(asset, supply, facts.checkedAt, refFromSource(f)));
    for (const f of mine.filter((f) => f.field === "toml_max_number")) results.push(checkTomlMaxNumber(asset, supply, facts.checkedAt, refFromSource(f)));
    for (const f of mine.filter((f) => f.field === "units_outstanding")) {
      results.push(checkFiledShares(asset, supply, facts.checkedAt, refFromSource(f), ratio ? refFromClaim(ratio) : null));
    }
    for (const c of myClaims.filter((c) => c.field === "max_issuance" && typeof c.value === "number")) {
      const sameUnitRatio = myClaims.find((r) => r.field === "token_unit_ratio" && typeof r.value === "number" && r.unit === c.unit);
      results.push(checkMaxIssuance(asset, supply, facts.checkedAt, refFromClaim(c), sameUnitRatio ? refFromClaim(sameUnitRatio) : null));
    }

    for (const r of results) {
      checks.push(r);
      console.log(`${a.asset_code.padEnd(8)} ${r.check.padEnd(28)} ${r.status.padEnd(15)} ${r.statement}`);
      if (r.status === "mismatch" && r.reference) {
        try {
          const inv = await investigateSupplyMismatch({
            asset, check: r.check, supply, breakdown: facts.supplyBreakdown, reference: { label: r.reference.label, value: r.reference.value },
          });
          investigations.push(inv);
          console.log(`         investigation: ${inv.conclusion}`);
          for (const limit of inv.limits) console.log(`         limit: ${limit}`);
        } catch (err) {
          console.log(`         investigation error (${err instanceof Error ? err.message : err})`);
        }
      }
    }
  }

  // Issuers using a pinned asset code without verifying against its official domain.
  const tomlText = async (domain: string) => {
    try {
      const { bytes, finalUrl } = await fetchUntrustedBytes(stellarTomlUrl(domain), { maxBytes: MAX_TOML_BYTES, allowRedirect: sameSiteWww });
      return { url: finalUrl, text: new TextDecoder().decode(bytes), sha256: createHash("sha256").update(bytes).digest("hex") };
    } catch {
      return null;
    }
  };
  let identityInvestigations = 0;
  for (const code of [...new Set(universe.map((a) => a.asset_code))]) {
    if (identityInvestigations >= IDENTITY_TOTAL) break;
    const pinned = universe.filter((a) => a.asset_code === code);
    const official = pinned[0];
    const officialRecord = snapshots.all().find((r) => r.sourceClass === "issuer_toml" && r.assets.includes(`${official.asset_code}:${official.issuer}`));
    const officialToml = officialRecord ? { url: officialRecord.url, text: snapshots.readText(officialRecord.sha256) ?? "", sha256: officialRecord.sha256 } : null;
    await sleep(DELAY_MS);
    const { records } = await listIssuers(code);
    let done = 0;
    for (const rec of records.filter((r) => !pinned.some((p) => p.issuer === r.asset_issuer)).slice(0, ISSUERS_SCANNED)) {
      if (done >= IDENTITY_PER_CODE || identityInvestigations >= IDENTITY_TOTAL) break;
      const id = await checkIssuerIdentity(code, rec.asset_issuer, universe);
      if (id.status === "verified" || !id.homeDomain) continue;
      const toml = await tomlText(id.homeDomain);
      const inv = await investigateIdentityMismatch({
        code, issuer: rec.asset_issuer, status: id.status, homeDomain: id.homeDomain, officialDomains: id.officialDomains,
        trustlines: rec.accounts.authorized, supply: rec.balances.authorized, toml, officialToml,
      });
      investigations.push(inv);
      done++;
      identityInvestigations++;
      console.log(`${code.padEnd(8)} issuer_identity              ${id.status.padEnd(15)} ${inv.conclusion}`);
    }
  }

  // Facts across investigations: one account funding several of these issuers.
  const byFunder = new Map<string, string[]>();
  for (const inv of investigations) {
    const funder = (inv.steps.find((st) => st.step === "account_origin")?.data as { funder?: string } | undefined)?.funder;
    if (funder) byFunder.set(funder, [...(byFunder.get(funder) ?? []), inv.asset]);
  }
  const patterns = [...byFunder]
    .map(([funder, assets]) => ({ funder, assets, accounts: [...new Set(assets.map((a) => a.split(":")[1]))] }))
    .filter((g) => g.accounts.length > 1)
    .map((g) => ({
      pattern: "shared_funder",
      funder: g.funder,
      issuer_accounts: g.accounts,
      assets: g.assets,
      statement: `Account ${g.funder} created ${g.accounts.length} of the issuer accounts investigated above (${g.accounts.join(", ")}), which issue ${g.assets.map((a) => a.split(":")[0]).join(", ")}.`,
    }));
  for (const p of patterns) console.log(`pattern  ${p.statement}`);

  const outFile = path.join(DATA, "examinations", `${checkedAt.slice(0, 10)}.json`);
  writeJson(outFile, { checked_at: checkedAt, checks, investigations, patterns });
  const count = (s: string) => checks.filter((c) => c.status === s).length;
  console.log(
    `\n${sources.length} code-read facts → data/claims/sources.json. ${checks.length} checks: ${count("consistent")} consistent, ${count("mismatch")} mismatch, ${count("not_comparable")} not comparable; ${investigations.length} investigations → ${path.relative(DATA, outFile)}`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
