import Image from "next/image";
import { Container, SectionHeading } from "./container";
import { loadDemo } from "./demo";
import { HowTabs } from "./how-tabs";
import { STEPS, stepRows } from "./tabs";

/** The three steps as tabs. Each panel shows real data from the sample asset, read from the status file at build time. */
export function HowItWorks() {
  const demo = loadDemo();
  const steps = STEPS.map((s, i) => ({ ...s, rows: demo ? stepRows(demo, i) : [] }));
  return (
    <section id="how-it-works" aria-labelledby="how-title" className="scroll-mt-16 py-16 md:py-24">
      <Container>
        <SectionHeading id="how-title" lead="How" tail="it works" />
        <Image
          src="/images/how-it-works.webp"
          alt="Two robots in a row. One reads a document, the other stamps a checkmark on it, and a pipe leads to a black and lime data cube."
          width={1000}
          height={424}
          sizes="(min-width: 768px) 768px, 100vw"
          className="mx-auto mt-8 h-auto w-full max-w-3xl md:mt-10"
        />
        <HowTabs steps={steps} sample={demo ? `Sample data from ${demo.code}, as of ${demo.asOf}.` : null} />
      </Container>
    </section>
  );
}
