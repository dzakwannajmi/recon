/**
 * stellar.toml (SEP-1): fetch, parse, and check which issuer accounts and codes it lists.
 */
import { createHash } from "node:crypto";
import { parse } from "smol-toml";
import { fetchUntrustedText, type Transport } from "./http";

const MAX_TOML_BYTES = 100_000;

export type TomlCurrency = {
  code?: string;
  code_template?: string;
  issuer?: string;
  name?: string;
  desc?: string;
  anchor_asset_type?: string;
  anchor_asset?: string;
  attestation_of_reserve?: string;
  redemption_instructions?: string;
  [key: string]: unknown;
};

export type StellarToml = {
  ACCOUNTS?: unknown;
  DOCUMENTATION?: { ORG_NAME?: string; ORG_URL?: string; [key: string]: unknown };
  CURRENCIES?: unknown;
  [key: string]: unknown;
};

/** `lenient` means strict TOML parsing failed and the line-based fallback was used. */
export type TomlParseMode = "strict" | "lenient";

export type FetchedToml = { toml: StellarToml; url: string; finalUrl: string; sha256: string; parseMode: TomlParseMode };

/** Only follow redirects between `example.com` and `www.example.com`. */
export function sameSiteWww(fromHost: string, toHost: string) {
  const strip = (h: string) => h.toLowerCase().replace(/^www\./, "");
  return strip(fromHost) === strip(toHost);
}

export async function fetchStellarToml(domain: string, opts: { signal?: AbortSignal; transport?: Transport } = {}): Promise<FetchedToml> {
  const url = `https://${domain}/.well-known/stellar.toml`;
  const { text, finalUrl } = await fetchUntrustedText(url, {
    maxBytes: MAX_TOML_BYTES,
    signal: opts.signal,
    transport: opts.transport,
    allowRedirect: sameSiteWww,
  });
  const sha256 = createHash("sha256").update(text).digest("hex");
  return { ...parseStellarToml(text), url, finalUrl, sha256 };
}

/** Parse strictly; if the file is not valid TOML, fall back to `parseTomlLenient`. */
export function parseStellarToml(text: string): { toml: StellarToml; parseMode: TomlParseMode } {
  try {
    return { toml: parse(text) as StellarToml, parseMode: "strict" };
  } catch {
    return { toml: parseTomlLenient(text), parseMode: "lenient" };
  }
}

const ACCOUNT_ID = /\bG[A-Z2-7]{55}\b/g;

/**
 * Line-based fallback for real-world tomls with small syntax errors (e.g. a
 * missing closing quote). Reads only what identity checks need: ACCOUNTS,
 * [DOCUMENTATION] and [[CURRENCIES]] string fields.
 */
export function parseTomlLenient(text: string): StellarToml {
  const accounts: string[] = [];
  const currencies: TomlCurrency[] = [];
  const documentation: Record<string, string> = {};
  let section: "root" | "documentation" | "currency" | "other" = "root";
  let inAccounts = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (inAccounts) {
      accounts.push(...(line.match(ACCOUNT_ID) ?? []));
      if (line.includes("]")) inAccounts = false;
      continue;
    }
    if (line.startsWith("[")) {
      section = line === "[[CURRENCIES]]" ? "currency" : line === "[DOCUMENTATION]" ? "documentation" : "other";
      if (section === "currency") currencies.push({});
      continue;
    }
    const kv = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, key, rest] = kv;
    if (section === "root" && key === "ACCOUNTS") {
      accounts.push(...(rest.match(ACCOUNT_ID) ?? []));
      inAccounts = !rest.includes("]");
      continue;
    }
    const value = /^"([^"]*)"/.exec(rest)?.[1];
    if (value === undefined) continue;
    if (section === "currency") currencies[currencies.length - 1][key] = value;
    else if (section === "documentation") documentation[key] = value;
  }
  return { ACCOUNTS: accounts, DOCUMENTATION: documentation, CURRENCIES: currencies };
}

function accountsOf(toml: StellarToml) {
  return Array.isArray(toml.ACCOUNTS) ? toml.ACCOUNTS.filter((a): a is string => typeof a === "string") : [];
}

function currenciesOf(toml: StellarToml): TomlCurrency[] {
  return Array.isArray(toml.CURRENCIES)
    ? toml.CURRENCIES.filter((c): c is TomlCurrency => typeof c === "object" && c !== null && !Array.isArray(c))
    : [];
}

/** SEP-1 `code_template`: `?` matches any one character; lengths must match. */
export function codeTemplateMatches(template: string, code: string) {
  if (template.length !== code.length) return false;
  return [...template].every((ch, i) => ch === "?" || ch === code[i]);
}

function codeMatches(entry: TomlCurrency, code: string) {
  return entry.code === code || (typeof entry.code_template === "string" && codeTemplateMatches(entry.code_template, code));
}

/** Does this toml list the issuer account (in ACCOUNTS or as the issuer of any currency)? */
export function tomlListsAccount(toml: StellarToml, issuer: string) {
  return accountsOf(toml).includes(issuer) || currenciesOf(toml).some((c) => c.issuer === issuer);
}

/** Does this toml list this code (or a matching code_template) for this issuer? */
export function tomlListsCode(toml: StellarToml, issuer: string, code: string) {
  return currenciesOf(toml).some((c) => c.issuer === issuer && codeMatches(c, code));
}

/** The currency entry for this issuer and code, if the toml has one. */
export function findCurrency(toml: StellarToml, issuer: string, code: string) {
  return currenciesOf(toml).find((c) => c.issuer === issuer && codeMatches(c, code));
}
