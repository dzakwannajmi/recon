import { ButtonLink } from "@/components/ui/button-link";
import { AsciiBackground } from "./ascii-background";
import { Container } from "./container";
import { DitherImage } from "./dither-image";
import { HeroPrompt } from "./hero-prompt";

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="relative isolate overflow-hidden py-16 md:py-28">
      <AsciiBackground className="absolute inset-0 -z-20 [mask-image:linear-gradient(to_bottom,#000_55%,transparent)]" />
      {/* Keeps the text on a calm ground: the glyphs show mostly at the top and on the right. */}
      <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-r from-background/90 via-background/70 to-transparent" />
      <Container className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          <h1 id="hero-title" className="max-w-4xl text-[40px] leading-none tracking-[-0.03em] sm:text-[52px] md:text-[64px]">
            Check what issuers say against the ledger.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-foreground md:text-xl md:leading-[1.3]">
            Recon reads tokenized real-world asset documents, compares them with Stellar on-chain data, and publishes dated facts and flags.
          </p>
          <div className="mt-10 flex max-w-[640px] flex-col gap-4">
            <HeroPrompt />
            <ButtonLink href="#scope" variant="outline" className="w-fit">Read the scope</ButtonLink>
          </div>
        </div>
        <DitherImage className="hidden aspect-square w-full overflow-hidden rounded-[16px] border bg-card lg:block" />
      </Container>
    </section>
  );
}
