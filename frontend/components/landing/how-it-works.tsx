import { Ball } from "./ball";
import { Container, SectionHeading } from "./container";

const STEPS = [
  {
    title: "The model finds and reads",
    body: "An LLM starts from the issuer's stellar.toml, follows links on the issuer's official domain, and pulls claims out of the documents. Every claim carries an exact quote.",
  },
  {
    title: "Code checks the quote and the chain",
    body: "Code confirms the quote appears word for word in the saved document. If it does not, the claim is dropped. Code then compares the claim with Stellar mainnet data and sets the flags. The model never sets a flag.",
  },
  {
    title: "The result goes to a Soroban feed",
    body: "Flags and facts are written to a Soroban contract on Stellar testnet, so other programs can read them.",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="how-title" className="scroll-mt-16 py-16 md:py-24">
      <Container>
        <div className="flex items-end justify-between gap-6">
          <SectionHeading id="how-title">How it works</SectionHeading>
          <Ball className="size-28 shrink-0 md:size-40" />
        </div>
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
