import { COPY } from "@/lib/factsheet/copy";
import type { AssetType, Lang } from "@/lib/factsheet/copy-types";
import type { LoadedAsset, StatusFile } from "@/lib/factsheet/load";
import { bitmaskBinary, counts, explorerLinks, fmt, formatTimestamp, inputDate } from "@/lib/factsheet/view";
import { StatusBadge } from "./badges";
import { ClearSection, NotEvaluatedSection, RaisedSection } from "./flag-lists";
import { LangSwitch } from "./lang-switch";
import Link from "next/link";

const EXTERNAL = { target: "_blank", rel: "noopener noreferrer nofollow" } as const;
const linkCls = "text-primary underline-offset-4 hover:underline";

/** Label for an asset type; an unknown type falls back to the raw string. */
export function assetTypeLabel(lang: Lang, type: string): string {
  const labels = COPY[lang].assetTypes as Record<string, string>;
  return Object.hasOwn(labels, type) ? labels[type as AssetType] : type;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="shrink-0 text-muted-foreground sm:w-48">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

function Input({ label, input }: { label: string; input: StatusFile["inputs"]["checks"] }) {
  if (!input) return null;
  const date = inputDate(input.path);
  return (
    <Row label={label}>
      <span className="font-mono text-xs break-all">{date ?? input.path}</span>
      {input.checked_at && <span className="text-muted-foreground"> · {formatTimestamp(input.checked_at)} UTC</span>}
    </Row>
  );
}

/** The whole fact sheet body for one asset. Server component; everything comes from the status file. */
export function FactSheet({ lang, asset, status }: { lang: Lang; asset: LoadedAsset; status: StatusFile }) {
  const copy = COPY[lang];
  const c = counts(asset);
  const links = explorerLinks(asset.asset_code, asset.issuer);
  const summary = asset.status ? fmt(copy.status[asset.status], c) : fmt(copy.status.unpublished, c);
  const n = (k: "raised" | "clear" | "notEvaluated", v: number) => fmt(copy.counts[k], { n: v });

  return (
    <main lang={lang} className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <Link href={`/${lang}/assets`} className={linkCls}>{copy.nav.allAssets}</Link>
        <LangSwitch lang={lang} path={`/assets/${encodeURIComponent(asset.asset_code)}`} />
      </div>

      <header className="flex flex-col gap-4">
        <div>
          <p className="text-xs tracking-wide text-muted-foreground uppercase">{copy.header.eyebrow}</p>
          <h1 className="mt-1 text-3xl font-semibold break-words">{asset.asset_code}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={asset.status} unpublished={copy.status.unpublishedBadge} />
        </div>
        <p className="text-sm">{summary}</p>
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>{n("raised", c.raised)}</span>
          <span>{n("clear", c.clear)}</span>
          <span>{n("notEvaluated", c.not_evaluated)}</span>
        </p>
        <dl className="flex flex-col gap-3 text-sm">
          <Row label={copy.header.issuer}>{asset.issuer_org}</Row>
          <Row label={copy.header.assetType}>{assetTypeLabel(lang, asset.asset_type)}</Row>
          <Row label={copy.header.issuerAccount}>
            <span className="font-mono text-xs break-all">{asset.issuer}</span>
            {links && (
              <span className="mt-1 flex flex-wrap gap-x-4">
                <a href={links.horizon} {...EXTERNAL} className={linkCls}>{copy.evidence.horizonLink}</a>
                <a href={links.explorer} {...EXTERNAL} className={linkCls}>{copy.evidence.explorerLink}</a>
              </span>
            )}
          </Row>
        </dl>
        <p className="flex flex-col gap-1 text-xs text-muted-foreground">
          <span>{fmt(copy.header.statusAsOf, { date: status.as_of })}</span>
          <span>{fmt(copy.header.computedAt, { datetime: formatTimestamp(status.generated_at) })}</span>
        </p>
      </header>

      <p className="rounded-md border border-border/60 px-3 py-2 text-sm text-muted-foreground">{copy.computedTextNote}</p>

      <RaisedSection copy={copy} asset={asset} />
      <ClearSection copy={copy} asset={asset} />
      <NotEvaluatedSection copy={copy} asset={asset} />

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">{copy.sections.methodTitle}</h2>
        <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm">
          {copy.method.steps.map((s, i) => <li key={i}>{s}</li>)}
        </ol>
        <h3 className="font-medium">{copy.method.inputsTitle}</h3>
        <dl className="flex flex-col gap-3 text-sm">
          <Input label={copy.method.checks} input={status.inputs.checks} />
          <Input label={copy.method.previousChecks} input={status.inputs.previous_checks} />
          <Input label={copy.method.examinations} input={status.inputs.examinations} />
          <Row label={copy.method.rulesVersion}><span className="font-mono text-xs">{status.rules_version}</span></Row>
        </dl>
        <h3 className="font-medium">{copy.method.feedTitle}</h3>
        <dl className="flex flex-col gap-3 text-sm">
          <Row label={copy.method.bitmask}>
            <span className="font-mono text-xs">{asset.flags_bitmask} · {bitmaskBinary(asset.flags_bitmask)}</span>
          </Row>
          <Row label={copy.method.evidenceHash}><span className="font-mono text-xs break-all">{asset.evidence_hash}</span></Row>
        </dl>
        <p className="text-sm text-muted-foreground">{copy.method.feedNote}</p>
      </section>

      <footer className="border-t border-border/60 pt-6 text-sm text-muted-foreground">{copy.disclaimer}</footer>
    </main>
  );
}
