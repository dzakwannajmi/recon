import type { EvidenceRef } from "@/lib/flags/types";
import type { FactSheetCopy } from "@/lib/factsheet/copy-types";
import { evidenceView, fmt } from "@/lib/factsheet/view";

const EXTERNAL = { target: "_blank", rel: "noopener noreferrer nofollow" } as const;
const link = "text-primary underline-offset-4 hover:underline break-all";

/** One evidence item. Quotes, URLs, and hashes come from the data and are shown as text only. */
function EvidenceItem({ copy, item }: { copy: FactSheetCopy; item: EvidenceRef }) {
  const v = evidenceView(item);
  const e = copy.evidence;
  switch (v.kind) {
    case "chain_check":
      return <p>{fmt(e.chainCheck, { date: v.date })}</p>;
    case "examination":
      return <p>{fmt(e.examination, { date: v.date, check: v.check })}</p>;
    case "link":
      return (
        <p>
          {v.url ? <a href={v.url} {...EXTERNAL} className={link}>{v.label}</a> : <span className="font-mono text-xs break-all">{v.rawUrl}</span>}
        </p>
      );
    case "document":
      return (
        <div className="flex flex-col gap-2">
          <p className="break-words">
            <span className="text-muted-foreground">{v.quote === null ? e.documentSnapshot : e.source}: </span>
            {v.url ? (
              <a href={v.url} {...EXTERNAL} className={link}>{v.url}</a>
            ) : v.rawUrl ? (
              <span className="font-mono text-xs break-all">{v.rawUrl}</span>
            ) : (
              <span className="text-muted-foreground">{e.noPublicLink}</span>
            )}
          </p>
          {v.quote !== null && (
            <div>
              <div className="text-xs text-muted-foreground">{e.quote}</div>
              <blockquote className="mt-1 border-l-2 border-border pl-3 font-mono text-xs whitespace-pre-wrap break-words">{v.quote}</blockquote>
            </div>
          )}
          {v.where !== null && (
            <p className="break-words"><span className="text-muted-foreground">{e.location}: </span>{v.where}</p>
          )}
          {v.snapshot_sha256 !== null && (
            <p><span className="text-muted-foreground">{e.snapshot}: </span><span className="font-mono text-xs break-all">{v.snapshot_sha256}</span></p>
          )}
        </div>
      );
    default:
      return <p className="font-mono text-xs break-all">{v.ref}</p>;
  }
}

export function EvidenceList({ copy, evidence }: { copy: FactSheetCopy; evidence: EvidenceRef[] }) {
  if (evidence.length === 0) return null;
  return (
    <details className="group mt-3 rounded-md border border-border/60 px-3 py-2 text-sm">
      <summary className="cursor-pointer select-none text-muted-foreground">
        {copy.evidence.title} ({evidence.length})
      </summary>
      <ul className="mt-3 flex flex-col gap-4">
        {evidence.map((item, i) => (
          <li key={i} className="min-w-0 border-t border-border/40 pt-3 first:border-t-0 first:pt-0">
            <EvidenceItem copy={copy} item={item} />
          </li>
        ))}
      </ul>
    </details>
  );
}
