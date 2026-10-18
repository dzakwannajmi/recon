import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "./markdown";
import { parseMarkdown } from "./markdown-parse";

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

  it("is fast on adversarial input up to the cap and above it", () => {
    const cases = ["**a ".repeat(5_000), "*a ".repeat(6_666), "**a ".repeat(10_000), "*a **b ".repeat(5_000), "[x ".repeat(6_000) + "]"];
    for (const src of cases) {
      const t = performance.now();
      html(src);
      expect(performance.now() - t, `${src.slice(0, 8)} x${src.length}`).toBeLessThan(150);
    }
  });

  it("renders input over 20000 characters as plain text", () => {
    const src = "**a **".repeat(10_000);
    expect(src.length).toBeGreaterThan(20_000);
    const t = performance.now();
    const out = html(src + "\n[x](https://example.com)");
    expect(performance.now() - t).toBeLessThan(150);
    expect(out).not.toContain("<strong");
    expect(out).not.toContain("<a");
    expect(out).toContain("**a **");
  });

  it("rejects links with credentials in the URL", () => {
    for (const src of ["https://sec.gov@evil.com", "[x](https://user:pw@example.com/)", "[x](https://sec.gov@evil.com/path)"]) {
      const out = html(src);
      expect(out, src).not.toContain("<a");
      expect(out, src).not.toContain("href");
    }
  });

  it("does not let a URL-looking label point to another host", () => {
    for (const src of ["[https://sec.gov/x](https://evil.com)", "[sec.gov](https://evil.com/a)", "[see www.sec.gov/x here](https://evil.com)"]) {
      const out = html(src);
      expect(out, src).not.toContain("<a");
      expect(out, src).toContain("(evil.com)");
    }
    const same = html("[https://sec.gov/filing](https://sec.gov/other)");
    expect(same).toContain('href="https://sec.gov/other"');
    expect(html("[stellar.toml](https://example.com/.well-known/stellar.toml)")).toContain('href="https://example.com/.well-known/stellar.toml"');
  });

  it("renders a table with header, rows and alignment", () => {
    const out = html("| Issuer | Trustlines | Note |\n|:--|--:|:-:|\n| GCRY | 981 | ok |\n| GABC | 12 | new |");
    expect(out).toContain("<table");
    expect(out).toContain("overflow-x-auto");
    expect((out.match(/<th /g) ?? []).length).toBe(3);
    expect((out.match(/<tr/g) ?? []).length).toBe(3);
    expect(out).toMatch(/<th [^>]*text-left[^>]*>Issuer/);
    expect(out).toMatch(/<th [^>]*text-right[^>]*>Trustlines/);
    expect(out).toMatch(/<td [^>]*text-right[^>]*>981/);
    expect(out).toMatch(/<td [^>]*text-center[^>]*>ok/);
    expect(out).not.toContain("|");
  });

  it("pads and trims uneven rows to the header width", () => {
    const [t] = parseMarkdown("| a | b |\n|---|---|\n| 1 |\n| 1 | 2 | 3 |");
    if (t.t !== "table") throw new Error("expected table");
    expect(t.rows.map((r) => r.length)).toEqual([2, 2]);
    expect(t.rows[0][1]).toEqual([]);
  });

  it("keeps links in cells safe", () => {
    const out = html("| a | b |\n|---|---|\n| [x](https://example.com/p) | [y](javascript:alert(1)) |\n| [sec.gov](https://evil.com) | https://sec.gov@evil.com |");
    expect(out).toContain('href="https://example.com/p"');
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain('href="https://evil.com');
    expect(out).not.toContain('href="https://sec.gov@');
  });

  it("leaves a pipe line without a delimiter row as a paragraph", () => {
    const out = html("| a | b |\n| 1 | 2 |");
    expect(out).not.toContain("<table");
    expect(out).toContain("<p");
    expect(html("a | b\n|---|---|---|")).not.toContain("<table");
  });

  it("shows raw HTML in cells as literal text", () => {
    const out = html("| a |\n|---|\n| <script>alert(1)</script> <img src=x onerror=alert(1)> |");
    expect(out).toContain("<table");
    expect(out).not.toContain("<script");
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;script&gt;");
  });

  it("caps rows and columns, and ends the table at a blank line", () => {
    const row = (v: string) => `| ${Array.from({ length: 15 }, () => v).join(" | ")} |`;
    const src = [row("h"), row("---"), ...Array.from({ length: 250 }, () => row("x")), "", "after"].join("\n");
    const blocks = parseMarkdown(src);
    expect(blocks.length).toBe(2);
    const t = blocks[0];
    if (t.t !== "table") throw new Error("expected table");
    expect(t.rows.length).toBe(200);
    expect(t.header.length).toBe(12);
    expect(t.align.length).toBe(12);
    expect(blocks[1].t).toBe("p");
  });

  it("splits on unescaped pipes only", () => {
    const [t] = parseMarkdown("| a | b |\n|---|---|\n| x \\| y | z |");
    if (t.t !== "table") throw new Error("expected table");
    expect(t.rows[0].length).toBe(2);
    expect(t.rows[0][0]).toEqual([{ t: "text", text: "x | y" }]);
  });

  it("does not use dangerouslySetInnerHTML", async () => {
    const fs = await import("fs");
    const src = fs.readFileSync(new URL("./markdown.tsx", import.meta.url), "utf8");
    expect(src).not.toContain("dangerouslySetInnerHTML");
  });
});
