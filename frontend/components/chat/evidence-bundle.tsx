import type { BundleView } from "@/lib/browser-payer/bundle";

const dash = (v: string | null) => v ?? "not given";

/**
 * The paid bundle as text only. React escapes every string; issuer quotes and source URLs are shown as plain text,
 * never as links or markup, because they are untrusted issuer content. Nothing here is sent back to the model.
 */
export function BundleBody({ view }: { view: BundleView }) {
  const h = "font-mono text-muted-foreground uppercase";
  const box = "flex flex-col gap-1 rounded-[6px] bg-secondary p-2 [overflow-wrap:anywhere] whitespace-pre-wrap";
  return (
    <div className="flex flex-col gap-3 border-t pt-3" data-testid="bundle">
      <p className="text-muted-foreground">Untrusted issuer text below is quoted, not endorsed. Stored checks as of the dates shown, not a live audit.</p>
      <div>
        <p className={h}>Asset</p>
        <p>{dash(view.asset.code)} issued by {dash(view.asset.issuer_org)}</p>
        <p className="font-mono">{dash(view.asset.issuer)}</p>
        <p>Stored status {dash(view.status.value)}, as of {dash(view.status.as_of)}</p>
        <p>Testnet feed read: {dash(view.feed.read)}{view.feed.matches === null ? "" : view.feed.matches ? ", matches the stored file" : ", does not match the stored file"}</p>
      </div>
      <div>
        <p className={h}>Raised flags ({view.flags.length})</p>
        {view.flags.length === 0 && <p>None raised.</p>}
        {view.flags.map((f, i) => (
          <div key={i} className={`${box} mt-1`}>
            <p>{dash(f.flag)} ({dash(f.severity)}), as of {dash(f.as_of)}</p>
            <p>{dash(f.text)}</p>
            {f.evidence.map((e, j) => (
              <div key={j} className="border-l-2 pl-2">
                <p>Quote: {dash(e.quote)}</p>
                <p>Source: {dash(e.source_url)} {e.where ? `(${e.where})` : ""}</p>
                <p className="font-mono">Snapshot SHA-256: {dash(e.snapshot_sha256)}</p>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div>
        <p className={h}>Issuer claims ({view.claims.length})</p>
        {view.claims.map((c, i) => (
          <div key={i} className={`${box} mt-1`}>
            <p>{dash(c.field)}: {dash(c.value_text)}</p>
            <p>Quote: {dash(c.quote)}</p>
            <p>Source: {dash(c.source_url)} ({dash(c.source_class)}, page {dash(c.page)})</p>
            <p className="font-mono">Snapshot SHA-256: {dash(c.snapshot_sha256)}</p>
          </div>
        ))}
      </div>
      <p className="font-mono">Evidence hash: {dash(view.evidence_hash)}</p>
    </div>
  );
}
