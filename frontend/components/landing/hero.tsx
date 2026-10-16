import { DEMO_HREF, FACT_SHEETS_HREF } from "@/components/layout/links";
import { ButtonLink } from "@/components/ui/button-link";
import { AsciiBackground } from "./ascii-background";
import { Container } from "./container";
import { HeroPrompt } from "./hero-prompt";
import { Mascot } from "./mascot";

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="relative isolate overflow-hidden bg-background pt-14 md:pt-20">
      <AsciiBackground className="absolute inset-0 -z-20" />
      {/* Keeps the text on a calm ground: the glyphs show mostly at the sides and below. */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 [background:radial-gradient(60%_45%_at_50%_22%,rgba(244,242,240,0.92),rgba(244,242,240,0.6)_60%,transparent)]"
      />
      <Container className="flex flex-col items-center text-center">
        <h1 id="hero-title" className="max-w-4xl text-[40px] leading-none tracking-[-0.03em] sm:text-[52px] md:text-[64px]">
          Check what issuers say against the ledger.
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-foreground md:text-xl md:leading-[1.3]">
          Recon reads tokenized real-world asset documents, compares them with Stellar on-chain data, and publishes dated facts and flags.
        </p>
        <div className="mt-8 flex w-full max-w-[640px] flex-col items-center gap-4">
          <HeroPrompt />
          <div className="flex flex-wrap items-center justify-center gap-3">
            <ButtonLink href={DEMO_HREF}>Try the agent</ButtonLink>
            <ButtonLink href={FACT_SHEETS_HREF} variant="outline">Browse fact sheets</ButtonLink>
          </div>
        </div>
      </Container>
      {/* The mascot is taller than its window; the section edge crops it. */}
      <div className="relative -mt-4 h-[calc(var(--mh)*0.78)] [--mh:480px] sm:[--mh:640px] md:[--mh:980px]">
        <Mascot className="absolute inset-x-0 top-0 h-[var(--mh)]" />
      </div>
    </section>
  );
}
