import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { DEMO_HREF, FACT_SHEETS_HREF } from "@/components/layout/links";
import { ButtonLink, GhostLink } from "@/components/ui/button-link";
import { Container } from "./container";
import { Mascot } from "./mascot";

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="relative isolate overflow-hidden">
      <Container className="grid items-center gap-6 py-12 md:grid-cols-2 md:gap-8 md:py-16">
        <div className="flex flex-col items-start">
          <Link
            href="/#why-recon"
            className="inline-flex items-center gap-1 rounded-full border bg-card px-3 py-1 text-xs hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
          >
            Facts and flags, never grades
            <ChevronRight aria-hidden className="size-3" />
          </Link>
          <h1 id="hero-title" className="mt-5 text-[40px] leading-[1.05] tracking-[-0.03em] sm:text-[52px] md:text-[60px]">
            Check what issuers say <span className="text-muted-foreground">against the blockchain.</span>
          </h1>
          <p className="mt-5 max-w-lg text-lg text-foreground md:text-xl md:leading-[1.3]">
            Recon reads the documents behind tokenized real-world assets, such as treasuries and funds turned into digital tokens. It checks them against Stellar, a public blockchain, and publishes dated facts and flags.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <ButtonLink href={DEMO_HREF}>Ask the agent</ButtonLink>
            <GhostLink href={FACT_SHEETS_HREF}>Browse fact sheets</GhostLink>
          </div>
        </div>
        <Mascot className="relative h-[340px] sm:h-[420px] md:h-[600px]" />
      </Container>
    </section>
  );
}
