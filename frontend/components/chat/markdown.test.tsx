import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "./markdown";

const html = (text: string) => renderToStaticMarkup(<Markdown text={text} />);

describe("Markdown renderer", () => {
  it("renders headings, paragraphs, emphasis and inline code", () => {
    const out = html("# Title\n\nSome **bold** and *italic* and `code` text.");
    expect(out).toContain("<h3");
    expect(out).toContain("Title");
    expect(out).toMatch(/<strong[^>]*>bold<\/strong>/);
    expect(out).toMatch(/<em[^>]*>italic<\/em>/);
    expect(out).toMatch(/<code[^>]*>code<\/code>/);
    expect(out).not.toContain("**");
  });

  it("renders fenced code literally", () => {
    const out = html("```\n**not bold** <b>x</b>\n```");
    expect(out).toContain("<pre");
    expect(out).toContain("**not bold** &lt;b&gt;x&lt;/b&gt;");
    expect(out).not.toContain("<strong");
  });

  it("renders bullet and numbered lists, blockquote and rule", () => {
    const out = html("- one\n- two\n\n1. first\n2. second\n\n> quoted\n\n---\n\nend");
    expect(out).toContain("<ul");
    expect(out).toContain("<ol");
    expect((out.match(/<li/g) ?? []).length).toBe(4);
    expect(out).toContain("<blockquote");
    expect(out).toContain("<hr");
  });

  it("shows raw HTML as literal text", () => {
    const out = html('<script>alert(1)</script> <img src=x onerror=alert(1)> <b>hi</b>');
    expect(out).not.toContain("<script");
    expect(out).not.toContain("<img");
    expect(out).not.toContain("<b>");
    expect(out).toContain("&lt;script&gt;");
  });

  it("never renders images, only the alt text", () => {
    const out = html("![a cat](https://example.com/cat.png) after");
    expect(out).not.toContain("<img");
    expect(out).not.toContain("example.com");
    expect(out).toContain("a cat");
  });

  it("links only http and https; javascript: and data: become plain text", () => {
    const ok = html("[site](https://example.com/a?b=1)");
    expect(ok).toContain('href="https://example.com/a?b=1"');
    expect(ok).toContain('target="_blank"');
    expect(ok).toContain('rel="noopener noreferrer"');
    for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<b>x</b>", "/relative", "ftp://x.example/f"]) {
      const out = html(`[click me](${bad})`);
      expect(out, bad).not.toContain("<a");
      expect(out, bad).not.toContain("href");
      expect(out, bad).toContain("click me");
    }
  });

  it("turns bare http(s) URLs into safe links without trailing punctuation", () => {
    const out = html("See https://stellar.expert/explorer/public/asset/X.");
    expect(out).toContain('href="https://stellar.expert/explorer/public/asset/X"');
    expect(out).toContain("</a>.");
  });

  it("handles nested emphasis", () => {
    const a = html("**bold with *italic* inside**");
    expect(a).toMatch(/<strong[^>]*>bold with <em[^>]*>italic<\/em> inside<\/strong>/);
    const b = html("*italic with **bold** inside*");
    expect(b).toMatch(/<em[^>]*>italic with <strong[^>]*>bold<\/strong> inside<\/em>/);
  });

  it("keeps unclosed markers as literal text", () => {
    for (const src of ["**never closed", "*never closed", "`never closed", "[label](not a link", "[label", "a * b * c", "2 ** 3"]) {
      const out = html(src);
      expect(out, src).not.toContain("<strong");
      expect(out, src).not.toContain("<em");
      expect(out, src).not.toContain("<a");
      expect(out, src).toContain(src.replace(/&/g, "&amp;").replace(/</g, "&lt;"));
    }
  });

  it("keeps long account addresses inside the card (wrapping classes)", () => {
    const g = "G" + "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".repeat(2).slice(0, 55);
    const out = html(`Issuer \`${g}\` and ${g}`);
    expect(out).toContain("[overflow-wrap:anywhere]");
    expect(out).toContain("break-all");
    expect(out).toContain(g);
  });

  it("stays fast on 10k characters of hostile input", () => {
    const inputs = [
      "*".repeat(10_000),
      "**a ".repeat(2_500),
      "[".repeat(10_000),
      "[a](".repeat(2_500),
      "`".repeat(10_000),
      "*a ".repeat(3_333),
      "- ".repeat(5_000),
      "> ".repeat(5_000),
      "![x](".repeat(2_000),
      "http://".repeat(1_400),
      "\\".repeat(10_000),
      ("# h\n- a\n  - b\n    - c\n").repeat(400),
    ];
    for (const src of inputs) {
      const t = performance.now();
      html(src);
      expect(performance.now() - t, src.slice(0, 12)).toBeLessThan(500);
    }
  });

  it("does not use dangerouslySetInnerHTML", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync(new URL("./markdown.tsx", import.meta.url), "utf8");
    expect(src).not.toContain("dangerouslySetInnerHTML");
  });
});
