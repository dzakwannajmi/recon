/**
 * A single-pass HTML scanner for untrusted pages: visible text and links.
 *
 * It never builds a tree or matches tags against a stack, so its cost is
 * linear in the input. Tree-building parsers can take cubic time on
 * malformed nesting (e.g. 50 KB of unclosed <div>), which would let any
 * issuer page stall a run. Skipped elements (script, style, ...) jump to
 * their closing tag; an unterminated tag ends the scan.
 */
import { decodeHTML } from "entities";
import { normalizeWhitespace } from "./text";

const SKIP = new Set(["script", "style", "noscript", "template", "svg", "iframe", "object", "canvas"]);
const BLOCK = new Set([
  "address", "article", "aside", "blockquote", "br", "dd", "div", "dl", "dt", "figcaption", "figure", "footer", "form",
  "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "main", "nav", "ol", "p", "pre", "section", "table", "title",
  "tr", "ul",
]);
const CELL = new Set(["td", "th"]);
const TAG_NAME = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)/;
const HREF = /\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i;
/** Attributes are only read from tags up to this size (bounds the regex work). */
const MAX_TAG_CHARS = 8192;

export type HtmlLink = { href: string; label: string };
export type HtmlScan = { text: string; links: HtmlLink[] };

export function scanHtml(html: string, maxLinks = 5000): HtmlScan {
  const out: string[] = [];
  const links: HtmlLink[] = [];
  let link: { href: string; label: string[] } | null = null;
  const emit = (s: string) => {
    out.push(s);
    link?.label.push(s);
  };
  const closeLink = () => {
    if (link && links.length < maxLinks) links.push({ href: link.href, label: normalizeWhitespace(link.label.join(" ")) });
    link = null;
  };

  const n = html.length;
  let i = 0;
  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      emit(decodeHTML(html.slice(i)));
      break;
    }
    if (lt > i) emit(decodeHTML(html.slice(i, lt)));

    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (html[lt + 1] === "!" || html[lt + 1] === "?") {
      const end = html.indexOf(">", lt);
      i = end === -1 ? n : end + 1;
      continue;
    }
    const m = TAG_NAME.exec(html.slice(lt, lt + 64));
    if (!m) {
      emit("<");
      i = lt + 1;
      continue;
    }
    const end = html.indexOf(">", lt);
    if (end === -1) break; // unterminated tag: ignore the rest
    const closing = m[1] === "/";
    const name = m[2].toLowerCase();
    const tag = end - lt < MAX_TAG_CHARS ? html.slice(lt, end + 1) : "";
    i = end + 1;

    if (!closing && SKIP.has(name) && !tag.endsWith("/>")) {
      const closeTag = new RegExp(`</${name}[\\s>]`, "gi");
      closeTag.lastIndex = i;
      const found = closeTag.exec(html);
      if (!found) break;
      const after = html.indexOf(">", found.index);
      i = after === -1 ? n : after + 1;
      continue;
    }
    if (name === "a") {
      closeLink();
      if (!closing) {
        const href = HREF.exec(tag);
        if (href) link = { href: decodeHTML(href[1] ?? href[2] ?? href[3] ?? ""), label: [] };
      }
      continue;
    }
    if (BLOCK.has(name)) emit("\n");
    else if (CELL.has(name) && !closing) emit(" ");
  }
  closeLink();
  // One block per line: the quote verifier never has to cross blank lines.
  return { text: normalizeWhitespace(out.join("")).replace(/\n+/g, "\n"), links };
}
