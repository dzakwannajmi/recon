import { loadStatus } from "@/lib/factsheet/load";
import { initialsOf, orbitAssets } from "@/lib/factsheet/logos";
import { groupByIssuer, statsFrom } from "@/lib/factsheet/stats";
import { OrbitRotation } from "@/components/ui/orbit-rotation";
import { Container, SectionHeading } from "./container";

/** The assets Recon checks, as logos on an orbit. Counts and date come from the newest status file at build time. */
export function AssetsList() {
  const { status } = loadStatus();
  const stats = statsFrom(status);
  const groups = groupByIssuer(status);
  return (
    <section id="assets" aria-labelledby="assets-title" className="scroll-mt-16 py-16 md:py-24">
      <Container>
        <SectionHeading id="assets-title" lead="Assets we" tail="check" />
        <p className="mx-auto mt-4 max-w-xl text-center text-lg text-muted-foreground">
          {stats.assets} assets from {stats.issuers} issuers, as of <span className="whitespace-nowrap">{status.as_of}</span>.
        </p>
        <OrbitRotation
          className="mt-8 md:mt-12"
          items={orbitAssets(groups).map((a) => ({
            href: `/en/assets/${encodeURIComponent(a.code)}`,
            src: a.src,
            name: `${a.issuer} ${a.code}`,
            short: initialsOf(a.code),
          }))}
        />
        <p className="mx-auto mt-6 max-w-xl text-center text-xs text-muted-foreground">
          Logos come from each issuer&apos;s own stellar.toml and belong to their owners. Franklin Templeton publishes no token image, so its mark here is an illustration of Benjamin Franklin, not the issuer's logo. A listing here does not mean an issuer endorses Recon.
        </p>
      </Container>
    </section>
  );
}
