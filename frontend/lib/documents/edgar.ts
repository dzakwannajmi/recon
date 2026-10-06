/**
 * SEC EDGAR filings (source class `regulatory_filing`, golden rule 3).
 *
 * The SEC requires a User-Agent with a contact email on every request and
 * allows at most 10 requests per second; we stay well under that.
 * https://www.sec.gov/os/accessing-edgar-data
 */
import { fetchUntrustedBytes, type Transport } from "../chain/http";

const SEC_HOSTS = new Set(["www.sec.gov", "data.sec.gov"]);
const MIN_INTERVAL_MS = 250;
const MAX_FILING_BYTES = 15_000_000;

/** Filing forms that carry fund-level numbers, newest first per series. */
export const FUND_REPORT_FORMS = ["N-MFP3", "NPORT-P"] as const;

export type SecIds = { ticker: string; cik: string; seriesId: string; classId: string };
export type FeedEntry = { form: string; filedAt: string; accession: string; indexUrl: string };

export function secUserAgent(email = process.env.SEC_CONTACT_EMAIL) {
  if (!email || !/^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(email)) return null;
  return `Recon research ${email}`;
}

/** US mutual fund and money market tickers are five letters ending in X (FOBXX, WTSYX). */
export const FUND_TICKER = /^[A-Z]{4}X$/;

/**
 * Find an SEC fund share class by ticker in company_tickers_mf.json ({ fields, data }).
 * Only fund-shaped tickers match, so a currency code like "USD" in a toml's
 * anchor_asset can never match an unrelated listed product.
 */
export function matchSecTicker(ticker: string, index: { fields: string[]; data: (string | number)[][] }): SecIds | null {
  if (!FUND_TICKER.test(ticker.trim().toUpperCase())) return null;
  const at = (name: string) => index.fields.indexOf(name);
  const row = index.data.find((r) => String(r[at("symbol")]).toUpperCase() === ticker.trim().toUpperCase());
  if (!row) return null;
  return {
    ticker: String(row[at("symbol")]),
    cik: String(row[at("cik")]),
    seriesId: String(row[at("seriesId")]),
    classId: String(row[at("classId")]),
  };
}

/** Parse an EDGAR browse-edgar Atom feed into filing entries (newest first, as served). */
export function parseFilingFeed(xml: string): FeedEntry[] {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].flatMap(([, entry]) => {
    const tag = (name: string) => new RegExp(`<${name}>([^<]+)</${name}>`).exec(entry)?.[1]?.trim();
    const form = tag("filing-type");
    const filedAt = tag("filing-date");
    const accession = tag("accession-number");
    const indexUrl = tag("filing-href");
    if (!form || !filedAt || !accession || !indexUrl || !/^\d{10}-\d{2}-\d{6}$/.test(accession)) return [];
    return [{ form, filedAt, accession, indexUrl }];
  });
}

/** Newest filing date first; the feed's own order breaks ties (it lists newest first). */
export function latestFirst(entries: FeedEntry[]) {
  return entries.map((e, i) => ({ e, i })).sort((a, b) => b.e.filedAt.localeCompare(a.e.filedAt) || a.i - b.i).map(({ e }) => e);
}

/** The machine-readable primary document of an XML filing (N-MFP3, NPORT-P). */
export function primaryXmlUrl(cik: string, accession: string) {
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, "")}/primary_doc.xml`;
}

export class EdgarClient {
  private last = 0;

  constructor(
    private readonly userAgent: string,
    private readonly transport?: Transport,
  ) {}

  async get(url: string, maxBytes = MAX_FILING_BYTES) {
    if (!SEC_HOSTS.has(new URL(url).hostname)) throw new Error("Not an SEC URL.");
    const wait = this.last + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    this.last = Date.now();
    return fetchUntrustedBytes(url, {
      maxBytes,
      timeoutMs: 30_000,
      headers: { "User-Agent": this.userAgent, Accept: "*/*" },
      allowRedirect: (from, to) => SEC_HOSTS.has(from) && SEC_HOSTS.has(to),
      transport: this.transport,
    });
  }

  /**
   * Latest filings of one form for a fund series, newest first, including
   * amendments (`form/A`). EDGAR's `type=` filter matches by prefix, so the
   * result is filtered to the exact form and its amendment.
   */
  async seriesFilings(seriesId: string, form: string, count = 10) {
    if (!/^S\d{9}$/.test(seriesId)) throw new Error("Invalid SEC series ID.");
    const url = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${seriesId}&type=${encodeURIComponent(form)}&dateb=&owner=include&count=${count}&output=atom`;
    const { bytes } = await this.get(url, 2_000_000);
    return latestFirst(parseFilingFeed(new TextDecoder().decode(bytes)).filter((e) => e.form === form || e.form === `${form}/A`));
  }

  /** The newest fund report (N-MFP3 for money market funds, else NPORT-P) for a series; the form used is in `form`. */
  async latestFundReport(seriesId: string) {
    for (const form of FUND_REPORT_FORMS) {
      const [latest] = await this.seriesFilings(seriesId, form);
      if (latest) return latest;
    }
    return null;
  }
}
