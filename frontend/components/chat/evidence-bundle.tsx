"use client";

import { useState } from "react";
import { Download, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BundleView } from "@/lib/browser-payer/bundle";
import { downloadName, downloadText, groupClaims, openPrintTab, printableHtml, shortId, UNTRUSTED_LINE } from "@/lib/browser-payer/evidence-view";

const dash = (v: string | null) => v ?? "not given";

/**
 * The paid bundle as a compact view: a header, the raised flags, and the claims grouped by field with overlapping
 * quotes collapsed. React escapes every string; issuer quotes and source URLs are shown as plain text, never as links or
 * markup, because they are untrusted issuer content. Nothing here is sent back to the model.
 *
 * `raw` is the response text exactly as received; with it, "Download JSON" saves the complete bundle untouched.
 * "Download PDF" opens a print-ready page (no library): choose Save as PDF in the print dialog.
 */
export function BundleBody({ view, raw }: { view: BundleView; raw?: string }) {
  const [notice, setNotice] = useState<string | null>(null);
  const h = "font-mono text-muted-foreground uppercase";
  const box = "flex flex-col gap-1 rounded-[6px] bg-secondary p-2 [overflow-wrap:anywhere] whitespace-pre-wrap";
  const groups = groupClaims(view.claims);
  const shown = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="flex flex-col gap-3 border-t pt-3" data-testid="bundle">
      <p className="text-muted-foreground">{UNTRUSTED_LINE}</p>

      <div className="flex flex-wrap gap-2">
        {raw !== undefined && (
          <Button size="sm" variant="outline" onClick={() => downloadText(downloadName(view, "json"), raw, "application/json")}>
            <Download /> Download JSON
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => setNotice(openPrintTab(printableHtml(view)) ? null : "Your browser blocked the print tab. Allow pop-ups for this page and try again.")}>
          <Printer /> Download PDF
        </Button>
      </div>
      {notice && <p role="alert" className="text-destructive">{notice}</p>}

      <div className="flex flex-col gap-0.5" data-testid="bundle-header">
        <p>{dash(view.asset.code)} issued by {dash(view.asset.issuer_org)}</p>
        <p className="font-mono" title={dash(view.asset.issuer)}>Issuer {shortId(view.asset.issuer)}</p>
        <p>Stored status {dash(view.status.value)}, as of {dash(view.status.as_of)}</p>
        <p>Testnet feed read: {dash(view.feed.read)}{view.feed.matches === null ? "" : view.feed.matches ? ", matches the stored file" : ", does not match the stored file"}</p>
        <p className="font-mono" title={dash(view.evidence_hash)}>Evidence hash {shortId(view.evidence_hash, 10, 8)}</p>
      </div>

      <div>
        <p className={h}>Raised flags ({view.flags.length})</p>
        {view.flags.length === 0 && <p>None raised.</p>}
        <ul className="mt-1 flex list-none flex-col gap-1 p-0">
          {view.flags.map((f, i) => (
            <li key={i} className={box}>
              <p>{dash(f.text)}</p>
              <p className="text-muted-foreground">{dash(f.flag)} ({dash(f.severity)}), as of {dash(f.as_of)}</p>
              {f.evidence.length > 0 && (
                <details>
                  <summary className="cursor-pointer focus-visible:outline-2 focus-visible:outline-foreground">Evidence ({f.evidence.length})</summary>
                  {f.evidence.map((ev, j) => (
                    <div key={j} className="mt-1 border-l-2 pl-2">
                      <p>Quote: {dash(ev.quote)}</p>
                      <p>Source: {dash(ev.source_url)}{ev.where ? ` (${ev.where})` : ""}</p>
                      <p className="font-mono">Snapshot SHA-256: {dash(ev.snapshot_sha256)}</p>
                    </div>
                  ))}
                </details>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div>
        <p className={h}>Issuer claims ({shown}{shown !== view.claims.length ? ` shown of ${view.claims.length}, overlapping quotes collapsed` : ""})</p>
        {groups.length === 0 && <p>None on file.</p>}
        {groups.map((g) => (
          <div key={g.field} className="mt-2">
            <p className="font-medium">{g.field} ({g.items.length})</p>
            {g.items.map(({ claim: c, collapsed }, i) => (
              <details key={i} className={`${box} mt-1`}>
                <summary className="cursor-pointer focus-visible:outline-2 focus-visible:outline-foreground">
                  {dash(c.value_text)}{collapsed > 0 ? ` (${collapsed} overlapping ${collapsed === 1 ? "quote" : "quotes"} collapsed)` : ""}
                </summary>
                <p className="mt-1">Quote: {dash(c.quote)}</p>
                <p>Source: {dash(c.source_url)}</p>
                <p>Page: {dash(c.page)} ({dash(c.source_class)})</p>
                <p className="font-mono">Snapshot SHA-256: {dash(c.snapshot_sha256)}</p>
              </details>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
