import { describe, expect, it } from "vitest";
import { isImageUrl, isOnOfficialDomain, issuerRedirectPolicy, pickDocumentLinks, seedsFor, tomlDocumentUrls } from "./discover";

const PAGE = "https://ylds.com/";
const links = (html: string) => pickDocumentLinks(html, PAGE, "ylds.com");

describe("pickDocumentLinks", () => {
  it("keeps document-like links and PDFs on the official domain", () => {
    expect(
      links(`<a href="/docs/fact-sheet">Fact sheet</a><a href="https://app.ylds.com/files/report.pdf">x</a><a href="/about">About</a>`),
    ).toEqual(["https://ylds.com/docs/fact-sheet", "https://app.ylds.com/files/report.pdf"]);
  });

  it("follows a link to another site only for a document-like PDF", () => {
    const html = [
      `<a href="https://cdn.figure.com/docs/markets/fcc-prospectus.pdf">Prospectus</a>`,
      `<a href="https://stablebonds.s3.amazonaws.com/privacy.pdf">Privacy</a>`,
      `<a href="https://policies.google.com/terms">Terms of Service</a>`,
      `<a href="https://www.newyorkfed.org/markets/reference-rates/sofr">SOFR holdings report</a>`,
    ].join("");
    expect(links(html)).toEqual(["https://cdn.figure.com/docs/markets/fcc-prospectus.pdf"]);
  });

  it("skips images, non-https links, malformed hrefs, and the page itself", () => {
    const html = `<a href="/logo-prospectus.png">p</a><a href="http://ylds.com/a.pdf">a</a><a href="https://[bad">b</a><a href="${PAGE}">Prospectus</a><a href="/x%E0%A4%A.pdf">c</a>`;
    expect(links(html)).toEqual(["https://ylds.com/x%E0%A4%A.pdf"]);
  });

  it("drops the fragment and de-duplicates", () => {
    expect(links(`<a href="/p.pdf#page=2">a</a><a href="/p.pdf">b</a>`)).toEqual(["https://ylds.com/p.pdf"]);
  });

  it("caps the number of links per page", () => {
    const html = Array.from({ length: 20 }, (_, i) => `<a href="/d${i}.pdf">d</a>`).join("");
    expect(links(html)).toHaveLength(8);
  });
});

describe("toml and pinned seeds", () => {
  it("collects https URLs from the currency and DOCUMENTATION, without images", () => {
    const urls = tomlDocumentUrls(
      { DOCUMENTATION: { ORG_URL: "https://www.wisdomtree.com", ORG_LOGO: "https://stellar.wisdomtree.com/wt.png" } },
      { attestation_of_reserve: "https://www.wisdomtreeprime.com/attestations/", image: "https://x.com/a.svg", desc: "not a url", http: "http://insecure.com/a.pdf" },
    );
    expect(urls).toEqual(["https://www.wisdomtreeprime.com/attestations/", "https://www.wisdomtree.com/"]);
  });

  it("accepts pinned URLs only on the official domain and keeps toml provenance", () => {
    const { seeds, rejected } = seedsFor({
      officialDomain: "bitbondsto.com",
      tomlUrl: "https://bitbondsto.com/.well-known/stellar.toml",
      tomlUrls: ["https://www.bitbondsto.com/"],
      pinnedUrls: ["https://www.bitbondsto.com/files/prospectus.pdf", "https://bitbond.com/press", "https://www.bitbondsto.com/"],
    });
    expect(seeds).toEqual([
      { url: "https://www.bitbondsto.com/", discoveredFrom: "https://bitbondsto.com/.well-known/stellar.toml" },
      { url: "https://www.bitbondsto.com/files/prospectus.pdf", discoveredFrom: null },
    ]);
    expect(rejected).toEqual(["https://bitbond.com/press"]);
  });

  it("matches the official domain exactly or by subdomain, never by lookalike", () => {
    expect(isOnOfficialDomain("https://app.ondo.finance/x", "ondo.finance")).toBe(true);
    expect(isOnOfficialDomain("https://ondo.finance.evil.com/x", "ondo.finance")).toBe(false);
    expect(isOnOfficialDomain("http://ondo.finance/x", "ondo.finance")).toBe(false);
    expect(isImageUrl("https://a.com/logo.PNG")).toBe(true);
  });
});

describe("issuerRedirectPolicy", () => {
  const allow = issuerRedirectPolicy("ylds.com");

  it("allows www swaps and moves onto the official domain", () => {
    expect(allow("ylds.com", "www.ylds.com")).toBe(true);
    expect(allow("cdn.figure.com", "www.cdn.figure.com")).toBe(true);
    expect(allow("cdn.figure.com", "docs.ylds.com")).toBe(true);
  });

  it("refuses third-party and lookalike targets", () => {
    expect(allow("ylds.com", "evil.com")).toBe(false);
    expect(allow("cdn.figure.com", "other.figure.com")).toBe(false);
    expect(allow("ylds.com", "ylds.com.evil.com")).toBe(false);
  });
});
