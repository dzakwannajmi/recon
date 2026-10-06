/**
 * Turn document bytes into plain text that quotes can be checked against.
 * The same function must be used for snapshots and for quote verification,
 * so the output is deterministic for the same bytes and extractor version.
 *
 * - PDF: text per page, pages joined with \f (form feed) so a quote can cite its page.
 * - HTML: visible text only, via a linear-time scanner (see html.ts).
 * - XML (e.g. SEC filings) and plain text: kept as is.
 *
 * Extraction runs in batch scripts, never on a server request path: pdf.js
 * runs on the main thread, and the timeout below can only stop it between
 * its async steps.
 */
import { extractText as extractPdfText, getResolvedPDFJS } from "unpdf";
import { scanHtml } from "./html";
import { normalizeWhitespace, stripControlChars } from "./text";

export { normalizeWhitespace } from "./text";

export type DocumentKind = "pdf" | "html" | "xml" | "text";
export type ExtractedText = { kind: DocumentKind; value: string; pages: number | null };

export const PAGE_BREAK = "\f";
/** Bump when any extractor's output can change; stored with every snapshot's text. */
export const EXTRACTOR_VERSION = "text-v2 unpdf@1.8.1 pdfjs@6.1.200 html-scan@1";
export const MAX_HTML_CHARS = 5_000_000;
export const MAX_PDF_PAGES = 500;
const PDF_TIMEOUT_MS = 60_000;

/** Fixed pdf.js options: no system fonts, no font or cMap URLs, so the output never depends on the environment. */
const PDF_OPTIONS = {
  useSystemFonts: false,
  disableFontFace: true,
  standardFontDataUrl: undefined,
  cMapUrl: undefined,
  verbosity: 0,
};

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

export function htmlToText(html: string) {
  if (html.length > MAX_HTML_CHARS) throw new Error(`HTML is larger than ${MAX_HTML_CHARS} characters.`);
  return scanHtml(html).text;
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} took longer than ${ms / 1000}s.`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** PDF text, one string per page. The input bytes are copied, never transferred or changed. */
export async function pdfToPages(bytes: Uint8Array) {
  const { getDocument } = await getResolvedPDFJS();
  const task = getDocument({ data: new Uint8Array(bytes), ...PDF_OPTIONS });
  try {
    const pdf = await withTimeout(task.promise, PDF_TIMEOUT_MS, "Opening the PDF");
    if (pdf.numPages > MAX_PDF_PAGES) throw new Error(`PDF has ${pdf.numPages} pages (limit ${MAX_PDF_PAGES}).`);
    const { text } = await withTimeout(extractPdfText(pdf, { mergePages: false }), PDF_TIMEOUT_MS, "Reading the PDF text");
    return (text as string[]).map((page) => normalizeWhitespace(stripControlChars(page)));
  } finally {
    await task.destroy();
  }
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
