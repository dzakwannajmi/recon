/**
 * ISSUER_IDENTITY (decision D-013).
 *
 * An issuer is verified only when (1) its home_domain is exactly a domain
 * pinned in data/assets.csv for that asset code (official_domain or the pinned
 * home_domain), and (2) that domain's stellar.toml lists the issuer account.
 * A home_domain alone proves nothing: anyone can set it, lookalike domains
 * can copy a real toml, and an unpinned subdomain may be controlled by
 * someone else (e.g. a dangling CNAME), so subdomains are never verified.
 *
 * `decideIdentity` is pure (no network) so it can be tested.
 */
import { isSafeDomain, isSameOrSubdomain, normalizeDomain, type Transport } from "./http";
import { ttlCache } from "./cache";
import { HORIZON_MAINNET, getIssuerAccount, type IssuerAccount } from "./horizon";
import { fetchStellarToml, tomlListsAccount, tomlListsCode, type FetchedToml, type TomlParseMode } from "./toml";
import { loadUniverse, officialDomainsFor, pinnedDomainsFor, type UniverseAsset } from "./universe";

export type IdentityStatus =
  | "verified" // pinned domain + its toml lists the issuer
  | "domain_mismatch" // home_domain is not the official domain pinned for this code
  | "subdomain_unpinned" // home_domain is a subdomain of the official domain, but not pinned
  | "not_listed_in_toml" // the domain's toml does not list this issuer account
  | "no_home_domain" // issuer account has no home_domain
  | "invalid_home_domain" // home_domain is not a valid public domain name
  | "issuer_not_found" // no such account on mainnet
  | "toml_unreachable" // could not fetch or parse stellar.toml
  | "toml_invalid" // the toml is not valid TOML and the fallback parser did not find the issuer
  | "unpinned"; // the toml lists the issuer, but no official domain is pinned for this code yet

export type IdentityInput = {
  issuerExists: boolean;
  /** The raw on-chain value; only echoed in reasons when it is a valid domain. */
  homeDomain?: string;
  tomlListsAccount?: boolean; // undefined when the toml could not be read
  tomlParseMode?: TomlParseMode;
  officialDomains: string[];
  pinnedDomains: string[];
  asOf: string; // YYYY-MM-DD
};

export type Severity = "CRITICAL" | "WARNING";

export type IdentityResult = {
  status: IdentityStatus;
  flag: "ISSUER_IDENTITY" | null;
  severity: Severity | null;
  reason: string;
};

const SEVERITY: Record<IdentityStatus, Severity | null> = {
  verified: null,
  domain_mismatch: "CRITICAL",
  not_listed_in_toml: "CRITICAL",
  no_home_domain: "CRITICAL",
  invalid_home_domain: "CRITICAL",
  issuer_not_found: "CRITICAL",
  subdomain_unpinned: "WARNING",
  toml_unreachable: "WARNING",
  toml_invalid: "WARNING", // a heuristic read of a broken file can't prove absence
  unpinned: "WARNING",
};

export function decideIdentity(input: IdentityInput): IdentityResult {
  const done = (status: IdentityStatus, reason: string): IdentityResult => ({
    status,
    flag: status === "verified" ? null : "ISSUER_IDENTITY",
    severity: SEVERITY[status],
    reason: `${reason} (as of ${input.asOf})`,
  });
  const official = input.officialDomains.join(" or ");
  const lenient = input.tomlParseMode === "lenient" ? "; this stellar.toml is not valid TOML and was read with a fallback parser" : "";

  if (!input.issuerExists) return done("issuer_not_found", "The issuer account does not exist on Stellar mainnet");
  if (!input.homeDomain) return done("no_home_domain", "The issuer account sets no home_domain, so it cannot be tied to an organization");
  const home = normalizeDomain(input.homeDomain);
  if (!home || !isSafeDomain(home)) return done("invalid_home_domain", "The issuer account's home_domain is not a valid public domain name");

  if (input.officialDomains.length > 0 && !input.pinnedDomains.includes(home)) {
    if (input.officialDomains.some((d) => isSameOrSubdomain(home, d))) {
      return done("subdomain_unpinned", `The issuer's home_domain ${home} is a subdomain of the official domain ${official}, but it is not a pinned domain for this asset`);
    }
    return done("domain_mismatch", `The issuer's home_domain ${home} does not match the official domain ${official} pinned for this asset`);
  }
  if (input.tomlListsAccount === undefined) return done("toml_unreachable", `Could not read stellar.toml at ${home}`);
  if (!input.tomlListsAccount && lenient) {
    return done("toml_invalid", `The stellar.toml at ${home} is not valid TOML, and the fallback parser did not find this issuer account in it`);
  }
  if (!input.tomlListsAccount) return done("not_listed_in_toml", `The stellar.toml at ${home} does not list this issuer account`);
  if (input.officialDomains.length === 0) {
    return done("unpinned", `The stellar.toml at ${home} lists this issuer, but no official domain is pinned for this asset yet${lenient}`);
  }
  return done("verified", `The issuer verifies against the official domain ${official}: the stellar.toml at ${home} lists this issuer account${lenient}`);
}

export type IdentityCheck = IdentityResult & {
  assetCode: string;
  issuer: string;
  /** Only set when it is a valid public domain (never echo raw on-chain text). */
  homeDomain: string | null;
  officialDomains: string[];
  /** Whether the toml lists this code (or a matching code_template) for this issuer; null if unknown. */
  codeListed: boolean | null;
  checkedAt: string;
  sources: string[];
  tomlSha256: string | null;
  /** "lenient" when the toml is not valid TOML and the line-based fallback was used. */
  tomlParseMode: TomlParseMode | null;
};

/** Everything read from the network for one issuer, and when it was read. */
type NetworkInputs = { account: IssuerAccount | null; toml: FetchedToml | null; fetchedAt: string };

const TTL_MS = 10 * 60 * 1000;
const DEGRADED_TTL_MS = 60 * 1000; // an unreachable toml is retried sooner
const cache = ttlCache<NetworkInputs>((v) => (v.account?.home_domain && !v.toml ? DEGRADED_TTL_MS : TTL_MS));

/** Shared by concurrent callers, so it uses only its own deadlines, never a caller's abort signal. */
async function loadNetworkInputs(issuer: string, transport?: Transport): Promise<NetworkInputs> {
  const fetchedAt = new Date().toISOString();
  const account = await getIssuerAccount(issuer);
  const home = normalizeDomain(account?.home_domain);
  let toml: FetchedToml | null = null;
  if (home) {
    try {
      toml = await fetchStellarToml(home, { transport });
    } catch {
      toml = null;
    }
  }
  return { account, toml, fetchedAt };
}

/** Network check: Horizon account → home_domain → stellar.toml, compared with the pinned universe. */
export async function checkIssuerIdentity(
  assetCode: string,
  issuer: string,
  universe: UniverseAsset[] = loadUniverse(),
  opts: { signal?: AbortSignal; transport?: Transport } = {},
): Promise<IdentityCheck> {
  const { account, toml, fetchedAt: checkedAt } = await cache.get(issuer, () => loadNetworkInputs(issuer, opts.transport), opts.signal);
  const officialDomains = officialDomainsFor(universe, assetCode);
  const homeDomain = normalizeDomain(account?.home_domain);

  const decision = decideIdentity({
    issuerExists: account !== null,
    homeDomain: account?.home_domain || undefined,
    tomlListsAccount: toml ? tomlListsAccount(toml.toml, issuer) : undefined,
    officialDomains,
    pinnedDomains: pinnedDomainsFor(universe, assetCode),
    tomlParseMode: toml?.parseMode,
    asOf: checkedAt.slice(0, 10),
  });

  const sources = [`${HORIZON_MAINNET}/accounts/${encodeURIComponent(issuer)}`];
  if (toml) sources.push(toml.finalUrl);
  return {
    ...decision,
    assetCode,
    issuer,
    homeDomain,
    officialDomains,
    codeListed: toml ? tomlListsCode(toml.toml, issuer, assetCode) : null,
    checkedAt,
    sources,
    tomlSha256: toml?.sha256 ?? null,
    tomlParseMode: toml?.parseMode ?? null,
  };
}

/** For tests only. */
export function clearIdentityCache() {
  cache.clear();
}
