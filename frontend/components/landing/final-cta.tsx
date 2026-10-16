import Image from "next/image";
import { DEMO_HREF, FACT_SHEETS_HREF } from "@/components/layout/links";
import { ButtonLink, GhostLink } from "@/components/ui/button-link";
import { Container } from "./container";

export function FinalCta() {
  return (
    <section aria-labelledby="cta-title" className="py-16 md:py-24">
      <Container className="grid items-center gap-10 md:grid-cols-2 md:gap-12">
        <div className="flex flex-col items-center text-center md:items-start md:text-left">
          <h2 id="cta-title" className="text-[32px] leading-[1.05] tracking-[-0.02em] md:text-[48px]">Read the facts. Check the record.</h2>
          <p className="mt-4 max-w-xl text-lg text-muted-foreground">Open a fact sheet or ask the agent about an asset.</p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3 md:justify-start">
            <ButtonLink href={DEMO_HREF}>Ask the agent</ButtonLink>
            <GhostLink href={FACT_SHEETS_HREF}>Browse fact sheets</GhostLink>
          </div>
        </div>
        <Image
          src="/images/cta.webp"
          alt="A robot waving next to a lime flag on a round base."
          width={955}
          height={928}
          sizes="(min-width: 768px) 420px, 240px"
          className="mx-auto h-auto w-full max-w-[240px] md:max-w-[420px]"
        />
      </Container>
    </section>
  );
}
