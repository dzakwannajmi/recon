/**
 * The asset universe: verified RWAs pinned to their official domains (data/assets.csv).
 * Domains are normalized on load; rows with an invalid official domain are skipped.
 */
import fs from "fs";
import path from "path";
import { normalizeDomain } from "./http";

export type UniverseAsset = {
  asset_code: string;
  issuer: string;
  home_domain: string;
  official_domain: string;
  official_domain_evidence: string;
  sac_contract_id: string;
  asset_type: string;
  issuer_org: string;
  docs_urls: string;
  holders: string;
  supply: string;
  source: string;
  as_of: string;
  notes: string;
};

const DEFAULT_PATH = path.join(process.cwd(), "..", "data", "assets.csv");

/** Parse CSV text (RFC 4180: quoted fields, escaped quotes, commas and newlines inside quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/** Build universe rows from CSV text, normalizing domains and dropping rows without a valid official domain. */
export function universeFromCsv(text: string): UniverseAsset[] {
  const [header, ...rows] = parseCsv(text.replace(/^﻿/, ""));
  if (!header) return [];
  const assets: UniverseAsset[] = [];
  for (const cells of rows) {
    const row = Object.fromEntries(header.map((h, i) => [h.trim(), (cells[i] ?? "").trim()])) as UniverseAsset;
    const official = normalizeDomain(row.official_domain);
    if (!official) {
      console.warn(`assets.csv: skipping ${row.asset_code || "a row"} because official_domain is not a valid domain.`);
      continue;
    }
    assets.push({ ...row, official_domain: official, home_domain: normalizeDomain(row.home_domain) ?? "" });
  }
  return assets;
}

export function loadUniverse(csvPath = process.env.ASSETS_CSV || DEFAULT_PATH): UniverseAsset[] {
  if (!fs.existsSync(csvPath)) return [];
  return universeFromCsv(fs.readFileSync(csvPath, "utf8"));
}

/** Official organization domains pinned for an asset code (one code can have several legitimate issuers). */
export function officialDomainsFor(universe: UniverseAsset[], code: string) {
  return [...new Set(universe.filter((a) => a.asset_code === code).map((a) => a.official_domain))];
}

/** Exact home_domain values accepted for a code: the pinned official domains and pinned home_domains. */
export function pinnedDomainsFor(universe: UniverseAsset[], code: string) {
  const rows = universe.filter((a) => a.asset_code === code);
  return [...new Set(rows.flatMap((a) => [a.official_domain, a.home_domain]).filter(Boolean))];
}
