import { Container, SectionHeading } from "./container";

const STEPS = [
  {
    title: "The model finds and reads",
    body: "An LLM reads the issuer's documents and extracts claims, each with an exact quote.",
  },
  {
    title: "Code checks the quote and the chain",
    body: "Code confirms the quote appears word for word, then compares the claim with Stellar mainnet data.",
  },
  {
    title: "The result goes to a Soroban feed",
    body: "Flags and facts are written to a Soroban contract on Stellar testnet.",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="how-title" className="scroll-mt-16 py-16 md:py-24">
      <Container>
        <SectionHeading id="how-title">How it works</SectionHeading>
        <ol className="mt-8 grid gap-8 md:grid-cols-3 md:gap-10">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex flex-col gap-3 border-t border-foreground pt-4">
              <span aria-hidden className="text-[10px] tracking-[0.18em] text-muted-foreground uppercase">0{i + 1}</span>
              <h3 className="text-xl leading-[1.3]">{s.title}</h3>
              <p className="text-muted-foreground">{s.body}</p>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}
