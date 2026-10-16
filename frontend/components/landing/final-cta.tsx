import { DEMO_HREF, FACT_SHEETS_HREF } from "@/components/layout/links";
import { ButtonLink } from "@/components/ui/button-link";
import { Container } from "./container";

export function FinalCta() {
  return (
    <section aria-labelledby="cta-title" className="py-16 md:py-24">
      <Container className="flex flex-col items-center text-center">
        <h2 id="cta-title" className="text-[32px] leading-[1.05] tracking-[-0.02em] md:text-[48px]">Read the facts. Check the ledger.</h2>
        <p className="mt-4 max-w-xl text-lg text-muted-foreground">Open a fact sheet or ask the agent about an asset.</p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <ButtonLink href={DEMO_HREF}>Try the agent</ButtonLink>
          <ButtonLink href={FACT_SHEETS_HREF} variant="outline">Browse fact sheets</ButtonLink>
        </div>
      </Container>
    </section>
  );
}
