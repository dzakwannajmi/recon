import Image from "next/image";
import Link from "next/link";
import { assetTypeLabel } from "@/components/factsheet/fact-sheet";
import { loadStatus } from "@/lib/factsheet/load";
import { orbitLogos } from "@/lib/factsheet/logos";
import { groupByIssuer, statsFrom } from "@/lib/factsheet/stats";
import { OrbitRotation } from "@/components/ui/orbit-rotation";
import { Container, SectionHeading } from "./container";

/** The assets Recon checks, as logos on an orbit. Counts and date come from the newest status file at build time. */
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
        <OrbitRotation
          className="mt-10 h-[30rem] overflow-hidden md:mt-14 md:h-[36rem]"
          items={orbitLogos(groups)}
          center={<Image src="/logo-mark.svg" alt="" width={56} height={56} className="size-14" />}
        />
        {/* The orbit is decorative; the same assets stay reachable as plain links. */}
        <ul className="sr-only">
          {groups.flatMap((g) =>
            g.assets.map((a) => (
              <li key={a.code}>
                <Link href={`/en/assets/${encodeURIComponent(a.code)}`}>
                  {g.issuer} {a.code}, {assetTypeLabel("en", a.type)}
                </Link>
              </li>
            )),
          )}
        </ul>
        <p className="mx-auto mt-6 max-w-xl text-center text-xs text-muted-foreground">
          Logos come from each issuer&apos;s own stellar.toml and belong to their owners. Franklin Templeton publishes no token image, so its mark here is an illustration of Benjamin Franklin, not the issuer's logo. A listing here does not mean an issuer endorses Recon.
        </p>
      </Container>
    </section>
  );
}
