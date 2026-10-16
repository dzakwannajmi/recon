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
        <HowTabs steps={steps} sample={demo ? `Sample data from ${demo.code}, as of ${demo.asOf}.` : null} />
      </Container>
    </section>
  );
}
