/**
 * Pure helpers for showing, downloading, and printing a paid bundle (spec W4.7). Everything shown comes from the
 * BundleView projection (lib/browser-payer/bundle.ts), whose strings are cut and have invisible characters escaped.
 * Issuer text is untrusted: the print page escapes every value for HTML and carries a CSP that allows no script.
 * No amounts anywhere.
 */
import type { BundleView, ClaimView } from "./bundle";

/** "GABCDE…XYZ123": the first and last characters of a long identifier. Short values are returned whole. */
export function shortId(value: string | null, head = 6, tail = 6): string {
  if (!value) return "not given";
  return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export type ClaimGroup = { field: string; items: { claim: ClaimView; collapsed: number }[] };

const norm = (s: string | null) => (s ?? "").trim().replace(/\s+/g, " ");

/**
 * Claims grouped by field (in order of first appearance). With `collapse` (the on-screen view), a claim is hidden only
 * when another claim of the same field, source, snapshot, value, and page has a longer quote that starts with its quote,
 * or the same quote and an earlier place in the list: a claim that differs in any of these is never hidden. The longest
 * quote is kept; the kept claim records how many it absorbed. Without `collapse` (the print page) every claim is listed.
 */
export function groupClaims(claims: ClaimView[], opts: { collapse?: boolean } = {}): ClaimGroup[] {
  const collapse = opts.collapse ?? true;
  const groups = new Map<string, ClaimView[]>();
  for (const c of claims) {
    const key = c.field ?? "unknown field";
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  return [...groups].map(([field, list]) => {
    const same = (a: ClaimView, b: ClaimView) =>
      a.source_url === b.source_url && a.snapshot_sha256 === b.snapshot_sha256 && a.value_text === b.value_text && a.page === b.page;
    const covers = (big: ClaimView, small: ClaimView, bigIndex: number, smallIndex: number) => {
      if (!same(big, small)) return false;
      const b = norm(big.quote);
      const s = norm(small.quote);
      if (s === "" || b === "") return false;
      return b.length > s.length ? b.startsWith(s) : b === s && bigIndex < smallIndex;
    };
    if (!collapse) return { field, items: list.map((claim) => ({ claim, collapsed: 0 })) };
    const kept = list.flatMap((c, i) => {
      const hidden = list.some((o, j) => j !== i && covers(o, c, j, i));
      return hidden ? [] : [{ claim: c, collapsed: list.filter((o, j) => j !== i && covers(c, o, i, j)).length }];
    });
    return { field, items: kept };
  });
}

// ---------------------------------------------------------------- files

/** A file name for a download: letters and digits from the asset code and the as-of date only. */
export function downloadName(view: BundleView, ext: "json" | "pdf"): string {
  const code = (view.asset.code ?? "asset").replace(/[^A-Za-z0-9]/g, "").slice(0, 12) || "asset";
  const day = (view.status.as_of ?? "").replace(/[^0-9-]/g, "").slice(0, 10);
  return `evidence-${code}${day ? `-${day}` : ""}.${ext}`;
}

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const NOT_GIVEN = "not given";
const e = (v: string | null) => escapeHtml(v ?? NOT_GIVEN);

export const UNTRUSTED_LINE = "Untrusted issuer text below is quoted, not endorsed. Stored checks as of the dates shown, not a live audit.";

const CSS = `
body{font:13px/1.45 system-ui,sans-serif;color:#151515;margin:24px;max-width:780px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:14px;margin:20px 0 6px;text-transform:uppercase;letter-spacing:.06em}
h3{font-size:13px;margin:12px 0 2px}p{margin:2px 0}code,.m{font-family:ui-monospace,Menlo,monospace;word-break:break-all}
.box{border:1px solid #bbb;border-radius:4px;padding:6px 8px;margin:6px 0;overflow-wrap:anywhere;white-space:pre-wrap;break-inside:avoid}
.note{border:1px solid #151515;padding:6px 8px;margin:10px 0}.hint{color:#555}
@media print{.hint{display:none}body{margin:0}}`;

/**
 * A full, self-contained HTML page of the bundle for printing to PDF. Every value is HTML-escaped; the page has a
 * Content-Security-Policy that allows no script, no network, and no images. Text stays selectable.
 */
export function printableHtml(view: BundleView): string {
  const flags = view.flags
    .map(
      (f) => `<div class="box"><p><b>${e(f.flag)}</b> (${e(f.severity)}), as of ${e(f.as_of)}</p><p>${e(f.text)}</p>${f.evidence
        .map((ev) => `<p>Quote: ${e(ev.quote)}</p><p>Source: ${e(ev.source_url)}${ev.where ? ` (${escapeHtml(ev.where)})` : ""}</p><p class="m">Snapshot SHA-256: ${e(ev.snapshot_sha256)}</p>`)
        .join("")}</div>`,
    )
    .join("");
  const claims = groupClaims(view.claims, { collapse: false })
    .map(
      (g) => `<h3>${escapeHtml(g.field)} (${g.items.length})</h3>${g.items
        .map(
          ({ claim: c }) => `<div class="box"><p>${e(c.value_text)}</p><p>Quote: ${e(c.quote)}</p><p>Source: ${e(c.source_url)} (${e(c.source_class)}, page ${e(c.page)})</p><p class="m">Snapshot SHA-256: ${e(c.snapshot_sha256)}</p></div>`,
        )
        .join("")}`,
    )
    .join("");
  const feed = `${e(view.feed.read)}${view.feed.matches === null ? "" : view.feed.matches ? ", matches the stored file" : ", does not match the stored file"}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${e(downloadName(view, "pdf"))}</title><style>${CSS}</style></head><body>
<p class="hint">Use Print, then Save as PDF. You can close this tab afterwards.</p>
<h1>Evidence for ${e(view.asset.code)}</h1>
<p>Issued by ${e(view.asset.issuer_org)}</p><p class="m">${e(view.asset.issuer)}</p>
<p>Stored status ${e(view.status.value)}, as of ${e(view.status.as_of)}</p>
<p>Testnet feed read: ${feed}</p>
<p>Bundle generated ${e(view.generated_at)}</p>
<div class="note">${escapeHtml(UNTRUSTED_LINE)}</div>
<h2>Raised flags (${view.flags.length})</h2>${view.flags.length === 0 ? "<p>None raised.</p>" : flags}
<h2>Issuer claims (${view.claims.length})</h2>${view.claims.length === 0 ? "<p>None on file.</p>" : claims}
<h2>Evidence hash</h2><p class="m">${e(view.evidence_hash)}</p>
</body></html>`;
}

// ---------------------------------------------------------------- browser actions (DOM injected for tests)

type DownloadDeps = { createObjectURL: (b: Blob) => string; revokeObjectURL: (u: string) => void; document: Pick<Document, "createElement" | "body">; later?: (f: () => void) => void };

/** Saves text as a file. The anchor is clicked once and removed; the object URL is released a moment later, so the download is not cancelled. */
export function downloadText(name: string, text: string, mime: string, deps?: DownloadDeps): void {
  const d = deps ?? { createObjectURL: (b: Blob) => URL.createObjectURL(b), revokeObjectURL: (u: string) => URL.revokeObjectURL(u), document };
  const url = d.createObjectURL(new Blob([text], { type: mime }));
  const a = d.document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  d.document.body.appendChild(a);
  a.click();
  a.remove();
  (d.later ?? ((f) => void setTimeout(f, 1000)))(() => d.revokeObjectURL(url));
}

type PrintWindow = { document: { write(s: string): void; close(): void }; focus(): void; print(): void; opener: unknown };

/** Opens the print page in a new tab and starts the print dialog. False when the browser blocked the tab. */
export function openPrintTab(html: string, open: () => PrintWindow | null = () => window.open("", "_blank") as PrintWindow | null, later: (f: () => void) => void = (f) => void setTimeout(f, 250)): boolean {
  const w = open();
  if (!w) return false;
  w.opener = null;
  w.document.write(html);
  w.document.close();
  w.focus();
  later(() => w.print());
  return true;
}
