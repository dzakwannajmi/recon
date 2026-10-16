import Link from "next/link";
import { assetTypeLabel } from "@/components/factsheet/fact-sheet";
import { loadStatus } from "@/lib/factsheet/load";
import { initialsOf, logoFor } from "@/lib/factsheet/logos";
import { groupByIssuer, statsFrom } from "@/lib/factsheet/stats";
import { Container, SectionHeading } from "./container";

/** Width of an issuer card on the 6-column grid: many assets fill the row, a few take half, one takes a third. */
const span = (n: number) => (n > 6 ? "md:col-span-6" : n > 1 ? "md:col-span-3" : "md:col-span-2");
/** Tile columns inside a card: 2 on a phone, more where the card is wide; one asset gets one column. */
const cols = (n: number) => (n > 6 ? "grid-cols-2 sm:grid-cols-3 md:grid-cols-5" : n > 1 ? "grid-cols-2 sm:grid-cols-3 md:grid-cols-2 lg:grid-cols-3" : "grid-cols-1");
const TILE = "size-10 shrink-0 rounded-[10px] border";

/** The assets Recon checks, grouped by issuer. Names, counts and date come from the newest status file at build time. */
export function AssetsList() {
  const { status } = loadStatus();
  const stats = statsFrom(status);
  // Biggest groups first (stable), so the cards pack into full rows.
  const groups = groupByIssuer(status).sort((a, b) => b.assets.length - a.assets.length);
  return (
    <section id="assets" aria-labelledby="assets-title" className="scroll-mt-16 py-16 md:py-24">
      <Container>
        <SectionHeading id="assets-title" lead="Assets we" tail="check" />
        <p className="mx-auto mt-4 max-w-xl text-center text-lg text-muted-foreground">
          {stats.assets} assets from {stats.issuers} issuers, as of <span className="whitespace-nowrap">{status.as_of}</span>.
        </p>
        <div className="mt-10 grid gap-4 md:mt-14 md:grid-cols-6 md:gap-6">
          {groups.map((g) => (
            <section
              key={g.issuer}
              aria-label={g.issuer}
              className={`rounded-[16px] border bg-card p-4 md:p-6 ${span(g.assets.length)}`}
            >
              <h3 className="text-xl leading-[1.3]">{g.issuer}</h3>
              <ul className={`mt-4 grid gap-2 md:gap-3 ${cols(g.assets.length)}`}>
                {g.assets.map((a) => {
                  const logo = logoFor(a.code);
                  return (
                    <li key={a.code}>
                      <Link
                        href={`/en/assets/${encodeURIComponent(a.code)}`}
                        className="flex items-center gap-3 rounded-[12px] border p-2 hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
                      >
                        {logo ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={logo} alt="" width={40} height={40} loading="lazy" className={`${TILE} bg-card object-contain p-1`} />
                        ) : (
                          <span aria-hidden className={`${TILE} flex items-center justify-center bg-background text-sm`}>
                            {initialsOf(a.code)}
                          </span>
                        )}
                        <span className="min-w-0">
                          <span className="block truncate">{a.code}</span>
                          <span className="block truncate text-xs text-muted-foreground">{assetTypeLabel("en", a.type)}</span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
        <p className="mx-auto mt-6 max-w-xl text-center text-xs text-muted-foreground">
          Logos come from each issuer&apos;s own token list and belong to their owners. A listing here does not mean an issuer endorses Recon.
        </p>
      </Container>
    </section>
  );
}
