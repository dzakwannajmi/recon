import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AssetIndex } from "@/components/factsheet/asset-index";
import { FactSheet } from "@/components/factsheet/fact-sheet";
import { COPY } from "./copy";
import { LANGS } from "./copy-types";
import { asset, clearFlag, EV, ISSUER, raisedFlag, statusFile } from "./fixtures";
import { loadStatus } from "./load";
import { fmt } from "./view";

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

describe("fact sheet render", () => {
  const { status } = loadStatus();

  it("renders every asset in every language with statements verbatim", () => {
    for (const lang of LANGS) {
      for (const asset of status.assets) {
        const html = renderToStaticMarkup(<FactSheet lang={lang} asset={asset} status={status} />);
        expect(html).toContain(`<main lang="${lang}"`);
        expect(html).toContain(asset.asset_code);
        expect(html).toContain(asset.evidence_hash);
        expect(html).not.toMatch(/javascript:/i);
        expect(html).not.toContain("dangerouslySetInnerHTML");
        for (const f of asset.raised) expect(html, `${asset.asset}:${f.flag}`).toContain(escapeHtml(f.statement));
        for (const f of asset.clear) expect(html, `${asset.asset}:${f.flag}`).toContain(escapeHtml(f.reason));
        for (const f of asset.not_evaluated) expect(html, `${asset.asset}:${f.flag}`).toContain(escapeHtml(f.reason));
      }
    }
  });

  it("renders the index in every language", () => {
    for (const lang of LANGS) {
      const html = renderToStaticMarkup(<AssetIndex lang={lang} status={status} />);
      expect(html).toContain(COPY[lang].index.title);
      for (const a of status.assets) expect(html).toContain(`/${lang}/assets/${encodeURIComponent(a.asset_code)}`);
    }
  });

  it("treats hostile data as text: no link for a bad URL, quotes escaped", () => {
    const evil = asset({
      raised: [raisedFlag({
        statement: "<script>alert(1)</script> statement",
        evidence: [{ kind: "claim", ref: "x", source_url: "javascript:alert(1)", snapshot_sha256: "ab", quote: "<img src=x onerror=alert(1)>", where: "p.1" }],
      })],
    });
    const html = renderToStaticMarkup(<FactSheet lang="en" asset={evil} status={statusFile([evil])} />);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; statement");
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain("javascript:alert(1)"); // shown as plain text
  });

  it("treats hostile data in a clear item as text too", () => {
    const evil = asset({
      clear: [clearFlag({
        reason: "<b>reason</b>",
        evidence: [{ kind: "source_fact", ref: "x", source_url: "data:text/html,<b>x</b>", snapshot_sha256: "ab", quote: "\"><a href=\"javascript:alert(2)\">x</a>", where: "<i>p</i>" }],
      })],
    });
    const html = renderToStaticMarkup(<FactSheet lang="id" asset={evil} status={statusFile([evil])} />);
    expect(html).not.toContain("<b>reason</b>");
    expect(html).toContain("&lt;b&gt;reason&lt;/b&gt;");
    expect(html).not.toContain('<a href="javascript:');
    expect(html).not.toMatch(/href="(javascript|data):/i);
    expect(html).toContain("&lt;i&gt;p&lt;/i&gt;");
  });

  it("shows the unpublished badge and sentence when status is null", () => {
    const a = asset({ status: null, status_code: null });
    for (const lang of LANGS) {
      const html = renderToStaticMarkup(<FactSheet lang={lang} asset={a} status={statusFile([a])} />);
      expect(html).toContain(escapeHtml(COPY[lang].status.unpublishedBadge));
      expect(html).toContain(escapeHtml(fmt(COPY[lang].status.unpublished, { raised: 0, clear: 1, not_evaluated: 1 })));
    }
  });

  it("shows a pending CRITICAL as WARNING with the review note; confirmed and rejected variants", () => {
    const cases = [
      { review: "pending", effective: "WARNING", badge: "WARNING" },
      { review: "confirmed", effective: "CRITICAL", badge: "CRITICAL" },
      { review: "rejected", effective: "WARNING", badge: "WARNING" },
    ] as const;
    for (const lang of LANGS) {
      for (const c of cases) {
        const a = asset({
          status: c.effective, status_code: c.effective === "CRITICAL" ? 2 : 1,
          raised: [raisedFlag({ severity: "CRITICAL", effective_severity: c.effective, review: c.review })],
        });
        const html = renderToStaticMarkup(<FactSheet lang={lang} asset={a} status={statusFile([a])} />);
        expect(html, `${lang}:${c.review}`).toContain(escapeHtml(COPY[lang].review[c.review]));
        expect(html, `${lang}:${c.review}`).toContain(`>${c.badge}</span>`);
        if (c.badge === "WARNING") expect(html).not.toContain(">CRITICAL</span>");
      }
    }
  });

  it("puts lang=en on code-generated statements and reasons, in every language", () => {
    const a = asset({ raised: [raisedFlag()] });
    const html = renderToStaticMarkup(<FactSheet lang="id" asset={a} status={statusFile([a])} />);
    expect(html).toContain(`<p lang="en" class="break-words whitespace-pre-wrap">${escapeHtml(a.raised[0].statement)}</p>`);
    expect(html).toContain(`<p lang="en" class="break-words whitespace-pre-wrap">${escapeHtml(a.clear[0].reason)}</p>`);
    expect(html).toContain(`<p lang="en" class="break-words whitespace-pre-wrap">${escapeHtml(a.not_evaluated[0].reason)}</p>`);
  });

  it("every external link has rel noopener noreferrer nofollow", () => {
    const all = [
      ...status.assets,
      asset({ raised: [raisedFlag({ evidence: [EV.chainLink, EV.sourceFact, EV.snapshot] })] }),
    ];
    let links = 0;
    for (const lang of LANGS) {
      for (const a of all) {
        const html = renderToStaticMarkup(<FactSheet lang={lang} asset={a} status={status} />);
        for (const tag of html.match(/<a\b[^>]*>/g) ?? []) {
          if (!/target="_blank"/.test(tag)) continue;
          links++;
          expect(tag).toContain('rel="noopener noreferrer nofollow"');
        }
      }
    }
    expect(links).toBeGreaterThan(0);
  });

  it("links an index code only when it is unambiguous", () => {
    const dupA = asset({ asset: `DUP:${ISSUER}`, asset_code: "DUP" });
    const dupB = asset({ asset: "DUP:GOTHER", asset_code: "DUP", issuer: "GOTHER" });
    const one = asset({ asset: `ONE:${ISSUER}`, asset_code: "ONE" });
    for (const lang of LANGS) {
      const html = renderToStaticMarkup(<AssetIndex lang={lang} status={statusFile([dupA, dupB, one])} />);
      expect(html).toContain(`href="/${lang}/assets/ONE"`);
      expect(html).not.toContain(`/assets/DUP`);
      expect(html.match(/>DUP</g)).toHaveLength(2);
    }
  });

  it("marks the current language with aria-current=page", () => {
    const a = asset();
    const html = renderToStaticMarkup(<FactSheet lang="en" asset={a} status={statusFile([a])} />);
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('href="/id/assets/AAA"');
  });
});
