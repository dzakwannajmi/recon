import { ButtonLink } from "@/components/ui/button-link";
import { DEMO_HREF } from "@/components/layout/links";
import { Container } from "./container";

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="py-16 md:py-28">
      <Container>
        <h1 id="hero-title" className="max-w-4xl text-[40px] leading-none tracking-[-0.03em] sm:text-[52px] md:text-[64px]">
          Check what issuers say against the ledger.
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-muted-foreground md:text-xl md:leading-[1.3]">
          Recon reads tokenized real-world asset documents, compares them with Stellar on-chain data, and publishes dated facts and flags.
        </p>
        <div className="mt-10 flex flex-wrap gap-3">
          <ButtonLink href={DEMO_HREF}>Try the live demo</ButtonLink>
          <ButtonLink href="#scope" variant="outline">Read the scope</ButtonLink>
        </div>
      </Container>
    </section>
  );
}
