import { loadStatus } from "@/lib/factsheet/load";
import { loadUniverse } from "@/lib/chain/universe";
import { initialsOf, orbitCompanies } from "@/lib/factsheet/logos";
import { groupByIssuer, statsFrom } from "@/lib/factsheet/stats";
import { OrbitRotation } from "@/components/ui/orbit-rotation";
import { Container, SectionHeading } from "./container";

/** The assets Recon checks, as logos on an orbit. Counts and date come from the newest status file at build time. */
export function AssetsList() {
  const { status } = loadStatus();
  const stats = statsFrom(status);
  const groups = groupByIssuer(status);
  // Official domains are the ones pinned with evidence in data/assets.csv (golden rule 3); the links go there, not to our own pages.
  const officialDomains = new Map(loadUniverse().map((a) => [a.issuer_org, a.official_domain]));
  return (
    <section id="assets" aria-labelledby="assets-title" className="scroll-mt-16 py-16 md:py-24">
      <Container>
        <SectionHeading id="assets-title" lead="Assets we" tail="check" />
        <p className="mx-auto mt-4 max-w-xl text-center text-lg text-muted-foreground">
          {stats.assets} assets from {stats.issuers} issuers, as of <span className="whitespace-nowrap">{status.as_of}</span>.
        </p>
        <OrbitRotation
          className="mt-8 md:mt-12"
          items={orbitCompanies(groups.map((g) => g.issuer)).map((c) => ({
            href: `https://${officialDomains.get(c.issuer)}`,
            src: c.src,
            name: c.issuer,
            short: initialsOf(c.issuer),
          }))}
        />
        <p className="mx-auto mt-6 max-w-xl text-center text-xs text-muted-foreground">
          Each logo opens that issuer&apos;s official site, the domain pinned in our asset list. Logos belong to their owners. Franklin Templeton&apos;s mark here is an illustration of Benjamin Franklin, not the issuer&apos;s logo. A listing here does not mean an issuer endorses Recon.
        </p>
      </Container>
    </section>
  );
}
