import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { DEMO_HREF, FACT_SHEETS_HREF } from "@/components/layout/links";
import { ButtonLink, GhostLink } from "@/components/ui/button-link";
import { loadLandingStats } from "@/lib/factsheet/stats";
import { AsciiBackground } from "./ascii-background";
import { Container } from "./container";
import { Mascot } from "./mascot";

export function Hero() {
  const stats = loadLandingStats();
  return (
    <section aria-labelledby="hero-title" className="relative isolate overflow-hidden bg-background">
      <AsciiBackground className="absolute inset-0 -z-20" />
      {/* Keeps the text on a calm ground: the glyphs show mostly around the robot. */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 [background:radial-gradient(60%_70%_at_25%_45%,rgba(244,242,240,0.94),rgba(244,242,240,0.7)_60%,transparent)]"
      />
      <Container className="grid items-center gap-6 py-12 md:grid-cols-2 md:gap-8 md:py-16">
        <div className="flex flex-col items-start">
          <Link
            href={FACT_SHEETS_HREF}
            className="inline-flex items-center gap-1 rounded-full border bg-card px-3 py-1 text-xs hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
          >
            {stats.assets} assets from {stats.issuers} issuers
            <ChevronRight aria-hidden className="size-3" />
          </Link>
          <h1 id="hero-title" className="mt-5 text-[40px] leading-[1.05] tracking-[-0.03em] sm:text-[52px] md:text-[60px]">
            Check what issuers say <span className="text-muted-foreground">against the ledger.</span>
          </h1>
          <p className="mt-5 max-w-lg text-lg text-foreground md:text-xl md:leading-[1.3]">
            Recon reads tokenized real-world asset documents, compares them with Stellar on-chain data, and publishes dated facts and flags.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <ButtonLink href={DEMO_HREF}>Try the agent</ButtonLink>
            <GhostLink href={FACT_SHEETS_HREF}>Browse fact sheets</GhostLink>
          </div>
        </div>
        <Mascot className="relative h-[340px] sm:h-[420px] md:h-[600px]" />
      </Container>
    </section>
  );
}
