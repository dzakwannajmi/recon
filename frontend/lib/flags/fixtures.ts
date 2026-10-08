/** Small inline fixtures shared by the flag tests. */
import type { IdentityCheck } from "../chain/identity";
import type { AssetFacts } from "../chain/asset";
import type { SnapshotRecord } from "../documents/store";
import type { CheckResult, Reference } from "../examine/checks";
import type { ChecksRow, ExamCheck } from "./types";

export const CODE = "BB1";
export const ISSUER = "GD5J6HLF5666X4AZLTFTXLY46J5SW7EXRKBLEYPJP33S33MXZGV6CWFN";
export const KEY = `${CODE}:${ISSUER}`;

export const identity = (over: Partial<IdentityCheck> = {}): IdentityCheck => ({
  status: "verified", flag: null, severity: null, reason: "The issuer verifies against the official domain bitbondsto.com (as of 2026-10-08)",
  assetCode: CODE, issuer: ISSUER, homeDomain: "bitbondsto.com", officialDomains: ["bitbondsto.com"], codeListed: true,
  checkedAt: "2026-10-08T01:34:10.993Z", sources: ["https://horizon.stellar.org/accounts/" + ISSUER, "https://bitbondsto.com/.well-known/stellar.toml"],
  tomlSha256: "t", tomlParseMode: "strict", ...over,
});

export const facts = (over: Partial<AssetFacts> = {}): AssetFacts => ({
  assetCode: CODE, issuer: ISSUER, exists: true, supply: "100.0000000",
  flags: { auth_required: true, auth_revocable: false, auth_immutable: false, auth_clawback_enabled: false },
  issuerSigners: [{ key: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", weight: 1 }],
  issuerThresholds: { low: 0, medium: 0, high: 0 },
  checkedAt: "2026-10-08T01:34:10.993Z", sources: [], ...over,
});

export const row = (over: Partial<ChecksRow> = {}): ChecksRow => ({
  asset_code: CODE, issuer: ISSUER, issuer_org: "Bit Bond", identity: identity(), facts: facts(), file: "data/checks/2026-10-08.json", ...over,
});

export const reference = (over: Partial<Reference> = {}): Reference => ({
  kind: "toml", label: "bitbondsto.com stellar.toml", value: 100, unit: "tokens", as_of: null, source_url: "https://bitbondsto.com/.well-known/stellar.toml",
  quote: 'fixed_number="100"', where: "[[CURRENCIES]] BB1, line 43", snapshot_sha256: "sha-toml", ...over,
});

export const check = (over: Partial<CheckResult> = {}): ExamCheck => ({
  asset: KEY, check: "supply_vs_toml_fixed_number", status: "mismatch", onchain: { supply: "105.0000000", as_of: "2026-10-08T01:14:16.540Z" },
  reference: reference(), ratio: null, threshold_tokens: "100", difference: "5.0000000",
  statement: "Mismatch between bitbondsto.com stellar.toml ([[CURRENCIES]] BB1, line 43, fixed_number 100) and on-chain supply 105.0000000 as of 2026-10-08.",
  file: "data/examinations/2026-10-08.json", ...over,
});

export const snapshot = (over: Partial<SnapshotRecord> = {}): SnapshotRecord => ({
  sha256: "sha-doc", url: "https://bitbondsto.com/doc", finalUrl: "https://bitbondsto.com/doc", contentType: "application/pdf", bytes: 10, sourceClass: "issuer",
  assets: [KEY], discoveredFrom: null, text: { kind: "pdf", chars: 5000, pages: 3, sha256: "t", extractor: "x" },
  fetchedAt: "2026-10-06T00:00:00.000Z", lastSeenAt: "2026-10-06T00:00:00.000Z", ...over,
});

/** Strings that must never appear in what we publish (golden rule 4). */
export const FORBIDDEN = /fraud|scam|unsafe|grade|rating|score|rated/i;
