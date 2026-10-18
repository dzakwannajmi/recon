/**
 * Small, safe markdown parser for chat answers. It produces a plain tree (no HTML, no React).
 * Emphasis closers are found once up front and looked up by binary search, so matching is linear per
 * nesting level (depth is capped). Input over MAX_INPUT characters is rendered as plain text.
 * Supported: headings, paragraphs, fenced code, bullet and numbered lists, blockquotes, rules,
 * GitHub-style tables (header row, delimiter row, body rows; capped at MAX_ROWS x MAX_COLS, cells are
 * parsed as inline markdown), and inline bold, italic, code, http(s) links. Everything else is literal text.
 */

export type Inline =
  | { t: "text"; text: string }
  | { t: "br" }
  | { t: "code"; text: string }
  | { t: "strong"; children: Inline[] }
  | { t: "em"; children: Inline[] }
  | { t: "link"; href: string; children: Inline[] };

export type Block =
  | { t: "heading"; level: number; children: Inline[] }
  | { t: "p"; children: Inline[] }
  | { t: "code"; text: string }
  | { t: "hr" }
  | { t: "quote"; blocks: Block[] }
  | { t: "list"; ordered: boolean; start: number; items: Block[][] }
  | { t: "table"; header: Inline[][]; align: TableAlign[]; rows: Inline[][][] };

export type TableAlign = null | "left" | "right" | "center";

const MAX_DEPTH = 5;
const isSpace = (c: string | undefined) => c === undefined || c === " " || c === "\t" || c === "\n" || c === "\r";
const isAlnum = (c: string | undefined) => !!c && ((c >= "0" && c <= "9") || (c >= "a" && c <= "z") || (c >= "A" && c <= "Z"));
const isPunct = (c: string) => "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~".includes(c);

export const MAX_INPUT = 20_000;
export const MAX_ROWS = 200;
export const MAX_COLS = 12;

/** Only http and https links are ever clickable, and never with credentials in the URL (https://sec.gov@evil.com). */
export function parseSafeUrl(raw: string): URL | null {
  const s = raw.trim();
  const head = s.slice(0, 8).toLowerCase();
  if (!head.startsWith("http://") && !head.startsWith("https://")) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (u.username || u.password) return null;
    return u;
  } catch {
    return null;
  }
}

export const safeHref = (raw: string): string | null => parseSafeUrl(raw)?.href ?? null;

const COMMON_TLDS = new Set(["com", "org", "net", "gov", "edu", "io", "co", "uk", "eu", "xyz", "app", "dev", "info", "ai", "us", "fi", "finance", "capital"]);

/** Host of a label token that looks like a URL (http(s)://..., www., or host with a common TLD), else null. */
function labelHost(token: string): string | null {
  const t = token.replace(/^[("'\[]+/, "").replace(/[)"'\].,;:!?]+$/, "");
  if (t.length === 0 || t.length > 256) return null;
  const lower = t.toLowerCase();
  const explicit = lower.startsWith("http://") || lower.startsWith("https://");
  if (!explicit) {
    const hostPart = lower.split(/[/?#]/, 1)[0];
    const parts = hostPart.split(".");
    if (parts.length < 2 || !(lower.startsWith("www.") || COMMON_TLDS.has(parts[parts.length - 1].split(":")[0]))) return null;
  }
  try {
    return new URL(explicit ? t : `https://${t}`).hostname;
  } catch {
    return null;
  }
}

/** A host the label claims that differs from the real one, or null when the label does not name a different site. */
function spoofedHost(label: string, real: string): boolean {
  for (const token of label.split(/\s+/)) {
    const h = labelHost(token);
    if (h !== null && h !== real) return true;
  }
  return false;
}

// ---------- inline ----------

type Fail = Record<string, number>;

/** Index of `token` at or after `from`, or -1. A miss is remembered so a later search cannot rescan the same tail. */
function find(src: string, token: string, from: number, fail: Fail): number {
  const known = fail[token];
  if (known !== undefined && from >= known) return -1;
  const at = src.indexOf(token, from);
  if (at < 0) fail[token] = Math.min(known ?? from, from);
  return at;
}

/** Sorted positions where an emphasis marker may close: not preceded by whitespace (and, for `*`, not part of `**`). */
function closerPositions(src: string): { double: number[]; single: number[] } {
  const double: number[] = [];
  const single: number[] = [];
  for (let k = 1; k < src.length; k++) {
    if (src[k] !== "*" || isSpace(src[k - 1])) continue;
    if (src[k + 1] === "*") double.push(k);
    else if (src[k - 1] !== "*") single.push(k);
  }
  return { double, single };
}

/** First element of the sorted list that is >= x, or -1. */
function firstAtLeast(list: number[], x: number): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo < list.length ? list[lo] : -1;
}

/** End (exclusive) of a bare URL starting at `i`, with trailing punctuation left out. */
function urlEnd(src: string, i: number): number {
  let j = i;
  while (j < src.length && !isSpace(src[j]) && src[j] !== "<" && src[j] !== ">" && src[j] !== '"') j++;
  while (j > i && ".,;:!?)]}'*".includes(src[j - 1])) j--;
  return j;
}

export function parseInline(src: string, depth = 0, inLink = false): Inline[] {
  const out: Inline[] = [];
  const fail: Fail = {};
  const closers = closerPositions(src);
  let buf = "";
  const flush = () => {
    if (buf) out.push({ t: "text", text: buf });
    buf = "";
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i];

    if (c === "\\" && i + 1 < src.length && isPunct(src[i + 1])) {
      buf += src[i + 1];
      i += 2;
      continue;
    }
    if (c === "\n") {
      flush();
      out.push({ t: "br" });
      i++;
      continue;
    }
    if (c === "`") {
      let run = 1;
      while (src[i + run] === "`") run++;
      const ticks = "`".repeat(run);
      const end = find(src, ticks, i + run, fail);
      if (end > i + run) {
        flush();
        out.push({ t: "code", text: src.slice(i + run, end).replace(/\n/g, " ") });
        i = end + run;
        continue;
      }
      buf += ticks;
      i += run;
      continue;
    }
    if (c === "*" && depth < MAX_DEPTH) {
      if (src[i + 1] === "*" && !isSpace(src[i + 2])) {
        const end = firstAtLeast(closers.double, i + 3);
        if (end > i + 2) {
          flush();
          out.push({ t: "strong", children: parseInline(src.slice(i + 2, end), depth + 1, inLink) });
          i = end + 2;
          continue;
        }
      } else if (src[i + 1] !== "*" && !isSpace(src[i + 1])) {
        const end = firstAtLeast(closers.single, i + 2);
        if (end > i + 1) {
          flush();
          out.push({ t: "em", children: parseInline(src.slice(i + 1, end), depth + 1, inLink) });
          i = end + 1;
          continue;
        }
      }
      buf += c;
      i++;
      continue;
    }
    if ((c === "[" || (c === "!" && src[i + 1] === "[")) && depth < MAX_DEPTH) {
      const image = c === "!";
      const open = image ? i + 1 : i;
      const close = find(src, "]", open + 1, fail);
      if (close > 0 && src[close + 1] === "(") {
        const end = find(src, ")", close + 2, fail);
        if (end > 0) {
          const label = src.slice(open + 1, close);
          const target = src.slice(close + 2, end).trim().split(/\s/, 1)[0] ?? "";
          const url = image || inLink ? null : parseSafeUrl(target);
          flush();
          if (url && !spoofedHost(label, url.hostname)) out.push({ t: "link", href: url.href, children: parseInline(label, depth + 1, true) });
          else {
            out.push(...parseInline(label, depth + 1, true)); // image alt text, an unsafe link, or a label that names another site
            if (url) out.push({ t: "text", text: ` (${url.hostname})` });
          }
          i = end + 1;
          continue;
        }
      }
      buf += src.slice(i, open + 1);
      i = open + 1;
      continue;
    }
    if ((c === "h" || c === "H") && !inLink && !isAlnum(src[i - 1]) && (src.startsWith("http://", i) || src.startsWith("https://", i))) {
      const end = urlEnd(src, i);
      const href = safeHref(src.slice(i, end));
      if (href) {
        flush();
        out.push({ t: "link", href, children: [{ t: "text", text: src.slice(i, end) }] });
        i = end;
        continue;
      }
    }
    buf += c;
    i++;
  }
  flush();
  return out;
}

// ---------- blocks ----------

const indentOf = (line: string) => {
  let n = 0;
  while (n < line.length && line[n] === " ") n++;
  return n;
};
const isBlank = (line: string) => line.trim() === "";

function fenceOf(line: string): string | null {
  const t = line.trimStart();
  if (indentOf(line) > 3 || !t.startsWith("```")) return null;
  let n = 0;
  while (t[n] === "`") n++;
  return "`".repeat(n);
}

function headingOf(line: string): { level: number; text: string } | null {
  if (indentOf(line) > 3) return null;
  const t = line.trim();
  let n = 0;
  while (t[n] === "#") n++;
  if (n < 1 || n > 6 || (t.length > n && t[n] !== " " && t[n] !== "\t")) return null;
  let text = t.slice(n).trim();
  let e = text.length;
  while (e > 0 && text[e - 1] === "#") e--;
  if (e === 0 || text[e - 1] === " ") text = text.slice(0, e).trim();
  return { level: n, text };
}

function isRule(line: string): boolean {
  const t = line.trim();
  if (t.length < 3 || (t[0] !== "-" && t[0] !== "*" && t[0] !== "_")) return false;
  for (const ch of t) if (ch !== t[0]) return false;
  return true;
}

type Marker = { ordered: boolean; number: number; content: string };

function markerOf(line: string): Marker | null {
  const ind = indentOf(line);
  if (ind > 3) return null;
  const t = line.slice(ind);
  if ((t[0] === "-" || t[0] === "*" || t[0] === "+") && (t[1] === " " || t[1] === "\t")) {
    return { ordered: false, number: 0, content: t.slice(2).trim() };
  }
  let n = 0;
  while (n < t.length && n < 9 && t[n] >= "0" && t[n] <= "9") n++;
  if (n > 0 && (t[n] === "." || t[n] === ")") && (t[n + 1] === " " || t[n + 1] === "\t")) {
    return { ordered: true, number: Number(t.slice(0, n)), content: t.slice(n + 2).trim() };
  }
  return null;
}

/** Cells of a table row: outer pipes dropped, split on pipes that are not escaped. One linear pass. */
function splitRow(line: string): string[] {
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  let end = t.length;
  if (end > 0 && t[end - 1] === "|") {
    let slashes = 0;
    while (end - 2 - slashes >= 0 && t[end - 2 - slashes] === "\\") slashes++;
    if (slashes % 2 === 0) end--;
  }
  t = t.slice(0, end);
  const cells: string[] = [];
  let from = 0;
  for (let k = 0; k < t.length; k++) {
    if (t[k] === "\\") k++;
    else if (t[k] === "|") {
      cells.push(t.slice(from, k).trim());
      from = k + 1;
    }
  }
  cells.push(t.slice(from).trim());
  return cells;
}

const DELIM_CELL = /^:?-+:?$/;

/** Alignments of a delimiter row (`|---|:--|--:|`) with exactly `count` cells, or null when the line is not one. */
function delimiterOf(line: string, count: number): TableAlign[] | null {
  if (!line.includes("|") || line.length > 2000) return null;
  const cells = splitRow(line);
  if (cells.length !== count) return null;
  const align: TableAlign[] = [];
  for (const c of cells) {
    if (!DELIM_CELL.test(c)) return null;
    const l = c[0] === ":";
    const r = c[c.length - 1] === ":";
    align.push(l && r ? "center" : r ? "right" : l ? "left" : null);
  }
  return align;
}

/** A table starts here when this line has pipes and the next line is a delimiter row with the same cell count. */
function tableStartAt(lines: string[], i: number): { header: string[]; align: TableAlign[] } | null {
  const line = lines[i];
  if (i + 1 >= lines.length || !line.includes("|") || indentOf(line) > 3) return null;
  const header = splitRow(line);
  const align = delimiterOf(lines[i + 1], header.length);
  return align ? { header, align } : null;
}

const startsBlock = (line: string) =>
  fenceOf(line) !== null || headingOf(line) !== null || line.trimStart().startsWith(">") || isRule(line) || markerOf(line) !== null;

export function parseBlocks(lines: string[], depth = 0): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }

    const fence = fenceOf(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !(lines[i].trim().startsWith(fence) && lines[i].trim().replace(/`/g, "") === "")) body.push(lines[i++]);
      i++; // closing fence (or end of input)
      blocks.push({ t: "code", text: body.join("\n") });
      continue;
    }

    const h = headingOf(line);
    if (h) {
      blocks.push({ t: "heading", level: h.level, children: parseInline(h.text) });
      i++;
      continue;
    }

    if (isRule(line)) {
      blocks.push({ t: "hr" });
      i++;
      continue;
    }

    if (line.trimStart().startsWith(">")) {
      const inner: string[] = [];
      while (i < lines.length && lines[i].trimStart().startsWith(">")) {
        const t = lines[i].trimStart().slice(1);
        inner.push(t[0] === " " ? t.slice(1) : t);
        i++;
      }
      blocks.push({ t: "quote", blocks: depth < MAX_DEPTH ? parseBlocks(inner, depth + 1) : [{ t: "p", children: [{ t: "text", text: inner.join("\n") }] }] });
      continue;
    }

    const table = tableStartAt(lines, i);
    if (table) {
      const cols = Math.min(table.header.length, MAX_COLS);
      const cell = (cells: string[]) => Array.from({ length: cols }, (_, k) => (cells[k] ? parseInline(cells[k]) : []));
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && !isBlank(lines[i]) && lines[i].includes("|")) {
        if (rows.length < MAX_ROWS) rows.push(cell(splitRow(lines[i])));
        i++;
      }
      blocks.push({ t: "table", header: cell(table.header), align: table.align.slice(0, cols), rows });
      continue;
    }

    const first = markerOf(line);
    if (first) {
      const items: Block[][] = [];
      while (i < lines.length) {
        const m = markerOf(lines[i]);
        if (!m || m.ordered !== first.ordered) break;
        const body: string[] = [m.content];
        i++;
        while (i < lines.length) {
          const l = lines[i];
          if (isBlank(l)) {
            let j = i;
            while (j < lines.length && isBlank(lines[j])) j++;
            if (j < lines.length && indentOf(lines[j]) >= 2) {
              for (; i < j; i++) body.push("");
              continue;
            }
            break;
          }
          if (indentOf(l) >= 2) {
            body.push(l.slice(2));
            i++;
          } else if (!startsBlock(l)) {
            body.push(l.trim());
            i++;
          } else break;
        }
        items.push(depth < MAX_DEPTH ? parseBlocks(body, depth + 1) : [{ t: "p", children: [{ t: "text", text: body.join("\n") }] }]);
        // a single blank line between items keeps the list going
        let j = i;
        while (j < lines.length && isBlank(lines[j])) j++;
        const next = j < lines.length ? markerOf(lines[j]) : null;
        if (next && next.ordered === first.ordered) i = j;
      }
      blocks.push({ t: "list", ordered: first.ordered, start: first.number, items });
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && !isBlank(lines[i])) {
      if (para.length > 0) {
        const m = markerOf(lines[i]);
        if (fenceOf(lines[i]) || headingOf(lines[i]) || lines[i].trimStart().startsWith(">") || isRule(lines[i]) || (m && (!m.ordered || m.number === 1)) || tableStartAt(lines, i)) break;
      }
      para.push(lines[i].trim());
      i++;
    }
    blocks.push({ t: "p", children: parseInline(para.join("\n")) });
  }
  return blocks;
}

export function parseMarkdown(src: string): Block[] {
  if (src.length > MAX_INPUT) {
    const children: Inline[] = [];
    src.split(/\r\n|\r|\n/).forEach((line, i) => {
      if (i > 0) children.push({ t: "br" });
      children.push({ t: "text", text: line });
    });
    return [{ t: "p", children }];
  }
  return parseBlocks(src.replace(/\r\n?/g, "\n").split("\n"));
}
