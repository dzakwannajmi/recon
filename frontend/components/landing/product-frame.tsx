import Link from "next/link";
import { StatusBadge } from "@/components/factsheet/badges";
import { assetTypeLabel } from "@/components/factsheet/fact-sheet";
import { COPY } from "@/lib/factsheet/copy";
import { loadStatus } from "@/lib/factsheet/load";
import { explorerLinks, fmt, safeHttpUrl } from "@/lib/factsheet/view";
import { Container, SectionHeading } from "./container";
import { pickSample } from "./sample";

const copy = COPY.en;

/** A real fact sheet, read from the newest status file when the page is built, inside a browser frame. */
export function ProductFrame() {
  const { status } = loadStatus();
  const sample = pickSample(status);
  if (!sample) return null;
  const { asset, flag, quote } = sample;
  const href = `/en/assets/${encodeURIComponent(asset.asset_code)}`;
  const url = safeHttpUrl(quote.source_url);
  const links = explorerLinks(asset.asset_code, asset.issuer);

  return (
    <section id="what-you-get" aria-labelledby="get-title" className="scroll-mt-16 py-16 md:py-24">
      <Container>
        <SectionHeading id="get-title">What you get</SectionHeading>
        <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
          For each asset: the claims found, each with its quote, source link, page, and document hash. Flags are listed with dates and evidence.
        </p>

        <figure className="mt-10 overflow-hidden rounded-[16px] border bg-card">
          <div className="flex items-center gap-3 border-b bg-secondary px-4 py-2.5">
            <span aria-hidden className="flex gap-1.5">
              <i className="size-2.5 rounded-full border border-input bg-card" />
              <i className="size-2.5 rounded-full border border-input bg-card" />
              <i className="size-2.5 rounded-full border border-input bg-card" />
            </span>
            <Link
              href={href}
              className="min-w-0 flex-1 truncate rounded-[6px] border bg-card px-3 py-1 font-mono text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
            >
              {href}
            </Link>
          </div>

          <div lang="en" className="grid gap-8 p-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] md:p-8">
            <div className="flex min-w-0 flex-col gap-4">
              <div>
                <p className="text-[10px] tracking-[0.18em] text-muted-foreground uppercase">{copy.header.eyebrow}</p>
                <p className="mt-1 text-[32px] leading-[1.05] tracking-[-0.02em] break-words">{asset.asset_code}</p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <StatusBadge status={asset.status} unpublished={copy.status.unpublishedBadge} />
                <span className="text-sm text-muted-foreground">{fmt(copy.header.statusAsOf, { date: status.as_of })}</span>
              </div>
              <dl className="flex flex-col gap-2 text-sm">
                <div>
                  <dt className="text-muted-foreground">{copy.header.issuer}</dt>
                  <dd>{asset.issuer_org}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{copy.header.assetType}</dt>
                  <dd>{assetTypeLabel("en", asset.asset_type)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{copy.header.issuerAccount}</dt>
                  <dd className="font-mono text-xs break-all">{asset.issuer}</dd>
                </div>
              </dl>
              {links && (
                <a href={links.explorer} target="_blank" rel="noopener noreferrer nofollow" className="w-fit rounded-[6px] text-sm underline underline-offset-4 hover:bg-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground">
                  {copy.evidence.explorerLink}
                </a>
              )}
            </div>

            <div className="flex min-w-0 flex-col gap-4 border-t pt-6 md:border-t-0 md:border-l md:pt-0 md:pl-8">
              <h3 className="text-sm text-muted-foreground">{copy.sections.raisedTitle}</h3>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="text-xl leading-[1.3]">{copy.flags[flag.flag]?.name ?? flag.flag}</p>
                <StatusBadge status={flag.effective_severity} unpublished="" />
              </div>
              <p className="break-words">{flag.statement}</p>
              <p className="text-xs text-muted-foreground">{fmt(copy.sections.asOf, { date: flag.as_of })}</p>
              <div>
                <p className="text-xs text-muted-foreground">{copy.evidence.quote}</p>
                <blockquote className="mt-1 border-l-2 border-foreground pl-3 font-mono text-xs break-words whitespace-pre-wrap">{quote.quote}</blockquote>
              </div>
              <dl className="flex flex-col gap-1 text-xs">
                <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
                  <dt className="shrink-0 text-muted-foreground">{copy.evidence.source}:</dt>
                  <dd className="min-w-0 break-all">{url ?? quote.source_url ?? copy.evidence.noPublicLink}</dd>
                </div>
                {quote.where && (
                  <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
                    <dt className="shrink-0 text-muted-foreground">{copy.evidence.location}:</dt>
                    <dd className="min-w-0 break-words">{quote.where}</dd>
                  </div>
                )}
                {quote.snapshot_sha256 && (
                  <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
                    <dt className="shrink-0 text-muted-foreground">{copy.evidence.snapshot}:</dt>
                    <dd className="min-w-0 font-mono break-all">{quote.snapshot_sha256}</dd>
                  </div>
                )}
              </dl>
            </div>
          </div>
        </figure>
      </Container>
    </section>
  );
}
