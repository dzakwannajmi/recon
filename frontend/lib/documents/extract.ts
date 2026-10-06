/**
 * Turn document bytes into plain text that quotes can be checked against.
 * The same function must be used for snapshots and for quote verification,
 * so the output is deterministic for the same bytes.
 *
 * - PDF: text per page, pages joined with \f (form feed) so a quote can cite its page.
 * - HTML: visible text only (no script/style), block elements on their own lines.
 * - XML (e.g. SEC filings) and plain text: kept as is.
 */
import { parse as parseHtml } from "node-html-parser";
import { extractText as extractPdfText, getDocumentProxy } from "unpdf";

export type DocumentKind = "pdf" | "html" | "xml" | "text";
export type ExtractedText = { kind: DocumentKind; value: string; pages: number | null };

export const PAGE_BREAK = "\f";

export function detectKind(bytes: Uint8Array, contentType: string): DocumentKind | null {
  const head = new TextDecoder().decode(bytes.subarray(0, 512)).trimStart().toLowerCase();
  const type = contentType.toLowerCase();
  if (type.startsWith("image/") || head.startsWith("<svg")) return null;
  if (head.startsWith("%pdf-") || type.includes("application/pdf")) return "pdf";
  if (type.includes("html") || head.startsWith("<!doctype html") || head.startsWith("<html")) return "html";
  if (type.includes("xml") || head.startsWith("<?xml")) return "xml";
  if (type.startsWith("text/") || type.includes("toml") || type === "") return "text";
  return null;
}

/** Collapse runs of spaces and blank lines; trim each line. */
export function normalizeWhitespace(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\t  ]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function htmlToText(html: string) {
  const root = parseHtml(html.replace(/<!doctype[^>]*>/gi, "").replace(/<!--[\s\S]*?-->/g, ""), { blockTextElements: { script: false, style: false, noscript: false, pre: true } });
  root.querySelectorAll("script, style, noscript, template, svg, iframe").forEach((el) => el.remove());
  return normalizeWhitespace(root.structuredText);
}

export async function pdfToPages(bytes: Uint8Array) {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractPdfText(pdf, { mergePages: false });
  return (text as string[]).map(normalizeWhitespace);
}

export async function extractText(bytes: Uint8Array, contentType: string): Promise<ExtractedText | null> {
  const kind = detectKind(bytes, contentType);
  if (kind === "pdf") {
    const pages = await pdfToPages(bytes);
    return { kind, value: pages.join(`\n${PAGE_BREAK}\n`), pages: pages.length };
  }
  if (kind === "html") return { kind, value: htmlToText(new TextDecoder().decode(bytes)), pages: null };
  if (kind === "xml" || kind === "text") return { kind, value: new TextDecoder().decode(bytes), pages: null };
  return null;
}
