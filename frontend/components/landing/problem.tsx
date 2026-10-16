import { Container, SectionHeading } from "./container";

const POINTS = [
  "Documents sit in one place. Ledger data sits in another.",
  "Documents are long PDFs and web pages. They can change.",
  "Checking them against the chain by hand, again and again, takes time.",
];

export function Problem() {
  return (
    <section aria-labelledby="problem-title" className="py-16 md:py-24">
      <Container className="grid gap-8 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-16">
        <SectionHeading id="problem-title">Why issuer claims are hard to check</SectionHeading>
        <ol className="border-t">
          {POINTS.map((p, i) => (
            <li key={p} className="flex gap-5 border-b py-5">
              <span aria-hidden className="w-6 shrink-0 pt-1.5 text-[10px] tracking-[0.18em] text-muted-foreground uppercase">0{i + 1}</span>
              <p className="text-lg md:text-xl md:leading-[1.3]">{p}</p>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}
