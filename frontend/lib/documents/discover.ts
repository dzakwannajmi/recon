/**
 * Document discovery from the issuer's official domain (golden rule 3).
 *
 * A document is an issuer source only if:
 * - its URL is listed in the issuer's stellar.toml (served from the pinned domain), or
 * - it is on the official domain (or a subdomain), or
 * - it is linked from a page on the official domain (one hop; the page is
 *   recorded as `discoveredFrom`, so a CDN-hosted PDF keeps its provenance).
 *   Links to other sites are followed only when they are PDFs whose name or
 *   label reads like a fund document; other sites' web pages never are.
 * Aggregators and other sites are never sources. All fetches go through the
 * SSRF-guarded client.
 */
import { isSameOrSubdomain, normalizeDomain } from "../chain/http";
import { sameSiteWww, type StellarToml } from "../chain/toml";
import { scanHtml } from "./html";

export type Seed = { url: string; discoveredFrom: string | null };

const DOC_WORDS = /prospectus|fact[\s_-]?sheet|attestation|audit|annual[\s_-]?report|semi[\s_-]?annual|offering|reserve|risk[\s_-]?disclosure|kiid|\bkid\b|financial[\s_-]?statement|holdings|\bnav\b|supplement/i;
const IMAGE_FILE = /\.(png|jpe?g|gif|svg|webp|ico|bmp)$/i;

export const isImageUrl = (url: string) => {
  try {
    return IMAGE_FILE.test(new URL(url).pathname);
  } catch {
    return false;
  }
};
const MAX_LINKS_PER_PAGE = 8;

function safeDecode(path: string) {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function httpsUrl(value: unknown): URL | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && normalizeDomain(url.hostname) ? url : null;
  } catch {
    return null;
  }
}

/**
 * Redirects allowed while fetching an issuer document: between `example.com`
 * and `www.example.com`, or onto the official domain (or a subdomain).
 * A redirect to any other site is refused, so provenance can't be laundered.
 */
export function issuerRedirectPolicy(officialDomain: string) {
  return (fromHost: string, toHost: string) => sameSiteWww(fromHost, toHost) || isSameOrSubdomain(toHost.toLowerCase(), officialDomain);
}

export function isOnOfficialDomain(url: string, officialDomain: string) {
  const u = httpsUrl(url);
  return u !== null && isSameOrSubdomain(u.hostname.toLowerCase(), officialDomain);
}

/** URLs the toml publishes for this asset (currency fields) and for the organization (DOCUMENTATION). */
export function tomlDocumentUrls(toml: StellarToml, currency: Record<string, unknown> | undefined) {
  const values = [...Object.values(currency ?? {}), ...Object.values(toml.DOCUMENTATION ?? {})];
  const urls = values.map(httpsUrl).filter((u): u is URL => u !== null).map((u) => u.toString());
  return [...new Set(urls.filter((u) => !isImageUrl(u)))];
}

/**
 * Links on an official page that look like documents. Links on the official
 * domain: PDFs or document-like anchors. Links to other sites: only PDFs whose
 * name or label reads like a fund document (e.g. a CDN-hosted prospectus).
 */
export function pickDocumentLinks(html: string, pageUrl: string, officialDomain: string): string[] {
  const found: string[] = [];
  for (const a of scanHtml(html).links) {
    let url: URL;
    try {
      url = new URL(a.href, pageUrl);
    } catch {
      continue;
    }
    if (url.protocol !== "https:" || !normalizeDomain(url.hostname) || IMAGE_FILE.test(url.pathname)) continue;
    url.hash = "";
    const isPdf = /\.pdf$/i.test(url.pathname);
    const looksLikeDoc = DOC_WORDS.test(`${a.label} ${safeDecode(url.pathname)}`);
    const onOfficial = isSameOrSubdomain(url.hostname.toLowerCase(), officialDomain);
    if (onOfficial ? !(isPdf || looksLikeDoc) : !(isPdf && looksLikeDoc)) continue;
    const href = url.toString();
    if (href !== pageUrl && !found.includes(href)) found.push(href);
    if (found.length >= MAX_LINKS_PER_PAGE) break;
  }
  return found;
}

/**
 * Seeds for one asset: toml-published URLs (provenance: the toml) and the
 * pinned docs_urls that are on the official domain. Off-domain pinned URLs
 * are returned as `rejected` so the run can report them.
 */
export function seedsFor(input: {
  officialDomain: string;
  tomlUrl: string | null;
  tomlUrls: string[];
  pinnedUrls: string[];
}): { seeds: Seed[]; rejected: string[] } {
  const seeds: Seed[] = [];
  const rejected: string[] = [];
  const add = (url: string, discoveredFrom: string | null) => {
    if (!seeds.some((s) => s.url === url)) seeds.push({ url, discoveredFrom });
  };
  for (const url of input.tomlUrls) if (!isImageUrl(url)) add(url, input.tomlUrl);
  for (const url of input.pinnedUrls) {
    if (isOnOfficialDomain(url, input.officialDomain)) add(new URL(url).toString(), null);
    else if (!seeds.some((s) => s.url === url)) rejected.push(url);
  }
  return { seeds, rejected };
}
