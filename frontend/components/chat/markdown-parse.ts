/**
 * Small, safe markdown parser for chat answers. It produces a plain tree (no HTML, no React) and never
 * uses regular expressions on whole documents, so long or hostile input stays linear.
 * Supported: headings, paragraphs, fenced code, bullet and numbered lists, blockquotes, rules,
 * and inline bold, italic, code, http(s) links. Everything else is literal text.
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
  | { t: "list"; ordered: boolean; start: number; items: Block[][] };

const MAX_DEPTH = 5;
const isSpace = (c: string | undefined) => c === undefined || c === " " || c === "\t" || c === "\n" || c === "\r";
const isAlnum = (c: string | undefined) => !!c && ((c >= "0" && c <= "9") || (c >= "a" && c <= "z") || (c >= "A" && c <= "Z"));
const isPunct = (c: string) => "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~".includes(c);

/** Only http and https links are ever clickable. Returns the normalized URL or null. */
export function safeHref(raw: string): string | null {
  const s = raw.trim();
  const head = s.slice(0, 8).toLowerCase();
  if (!head.startsWith("http://") && !head.startsWith("https://")) return null;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
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

function closeDouble(src: string, from: number, fail: Fail): number {
  let p = from;
  for (;;) {
    const at = find(src, "**", p, fail);
    if (at < 0) return -1;
    if (at > from && !isSpace(src[at - 1])) return at;
    p = at + 1;
  }
}

function closeSingle(src: string, from: number, fail: Fail): number {
  let p = from;
  for (;;) {
    const at = find(src, "*", p, fail);
    if (at < 0) return -1;
    if (src[at + 1] === "*") {
      p = at + 2;
      continue;
    }
    if (at > from && !isSpace(src[at - 1])) return at;
    p = at + 1;
  }
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
        const end = closeDouble(src, i + 2, fail);
        if (end > i + 2) {
          flush();
          out.push({ t: "strong", children: parseInline(src.slice(i + 2, end), depth + 1, inLink) });
          i = end + 2;
          continue;
        }
      } else if (src[i + 1] !== "*" && !isSpace(src[i + 1])) {
        const end = closeSingle(src, i + 1, fail);
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
          const href = image || inLink ? null : safeHref(target);
          flush();
          if (href) out.push({ t: "link", href, children: parseInline(label, depth + 1, true) });
          else out.push(...parseInline(label, depth + 1, true)); // image alt text, or an unsafe link: label only
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
        if (fenceOf(lines[i]) || headingOf(lines[i]) || lines[i].trimStart().startsWith(">") || isRule(lines[i]) || (m && (!m.ordered || m.number === 1))) break;
      }
      para.push(lines[i].trim());
      i++;
    }
    blocks.push({ t: "p", children: parseInline(para.join("\n")) });
  }
  return blocks;
}

export function parseMarkdown(src: string): Block[] {
  return parseBlocks(src.replace(/\r\n?/g, "\n").split("\n"));
}
