import { describe, expect, it } from "vitest";
import type { HttpResponse, Transport } from "../chain/http";
import { EdgarClient, matchSecTicker, parseFilingFeed, primaryXmlUrl, secUserAgent } from "./edgar";

const INDEX = {
  fields: ["cik", "seriesId", "classId", "symbol"],
  data: [
    [1786958, "S000067043", "C000215714", "FOBXX"],
    [1174610, "S000014258", "C000038817", "USD"],
  ],
};

const FEED = `<?xml version="1.0"?><feed>
<entry><content><accession-number>0000940400-26-036329</accession-number><filing-date>2026-08-31</filing-date>
<filing-href>https://www.sec.gov/Archives/edgar/data/1859001/000094040026036329/0000940400-26-036329-index.htm</filing-href><filing-type>NPORT-P</filing-type></content></entry>
<entry><content><accession-number>bad</accession-number><filing-date>2026-06-01</filing-date><filing-href>x</filing-href><filing-type>NPORT-P</filing-type></content></entry>
</feed>`;

describe("SEC helpers", () => {
  it("builds the User-Agent only from a plausible email", () => {
    expect(secUserAgent("ops@example.com")).toBe("Recon research ops@example.com");
    expect(secUserAgent("")).toBeNull();
    expect(secUserAgent("not an email")).toBeNull();
    expect(secUserAgent("a@b.com\r\nX-Injected: 1")).toBeNull();
  });

  it("matches fund tickers only, never a currency code", () => {
    expect(matchSecTicker("FOBXX", INDEX)).toEqual({ ticker: "FOBXX", cik: "1786958", seriesId: "S000067043", classId: "C000215714" });
    expect(matchSecTicker(" fobxx ", INDEX)?.ticker).toBe("FOBXX");
    expect(matchSecTicker("USD", INDEX)).toBeNull();
    expect(matchSecTicker("WTGXX", INDEX)).toBeNull();
  });

  it("parses filing entries and drops malformed ones", () => {
    expect(parseFilingFeed(FEED)).toEqual([
      {
        form: "NPORT-P",
        filedAt: "2026-08-31",
        accession: "0000940400-26-036329",
        indexUrl: "https://www.sec.gov/Archives/edgar/data/1859001/000094040026036329/0000940400-26-036329-index.htm",
      },
    ]);
  });

  it("builds the raw primary XML URL", () => {
    expect(primaryXmlUrl("0001859001", "0000940400-26-036329")).toBe(
      "https://www.sec.gov/Archives/edgar/data/1859001/000094040026036329/primary_doc.xml",
    );
  });
});

describe("EdgarClient", () => {
  const capture = () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const transport: Transport = async (url, init) => {
      seen.push({ url: url.toString(), headers: init.headers });
      return new Response(FEED, { status: 200, headers: { "content-type": "application/atom+xml" } }) as unknown as HttpResponse;
    };
    return { seen, transport };
  };

  it("sends the SEC User-Agent and parses the series feed", async () => {
    const { seen, transport } = capture();
    const client = new EdgarClient("Recon research ops@example.com", transport);
    const filings = await client.seriesFilings("S000072466", "NPORT-P");
    expect(filings).toHaveLength(1);
    expect(seen[0].headers["User-Agent"]).toBe("Recon research ops@example.com");
    expect(seen[0].url).toContain("CIK=S000072466&type=NPORT-P");
  });

  it("refuses non-SEC hosts and invalid series IDs", async () => {
    const client = new EdgarClient("Recon research ops@example.com", capture().transport);
    await expect(client.get("https://example.com/x")).rejects.toThrow(/Not an SEC URL/);
    await expect(client.seriesFilings("S1; drop", "NPORT-P")).rejects.toThrow(/Invalid SEC series ID/);
  });
});
