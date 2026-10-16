import { Container, SectionHeading, cardCls } from "./container";

const FEATURES = [
  { title: "Quote or discard", body: "A claim without a verbatim quote in the saved document is dropped." },
  { title: "Flags set by code", body: "Flags come from deterministic code. The model never sets one." },
  { title: "English and Indonesian", body: "Fact sheets are available in both languages." },
  { title: "Reads mainnet, writes testnet", body: "Recon reads Stellar mainnet and writes only to Stellar testnet." },
  { title: "Agent access", body: "Other agents can query checks through MCP. A detailed check can settle through x402 on Stellar testnet." },
];

export function Features() {
  return (
    <section id="key-features" aria-labelledby="features-title" className="scroll-mt-16 py-16 md:py-24">
      <Container>
        <SectionHeading id="features-title">Key features</SectionHeading>
        <ul className="mt-8 grid gap-4 md:grid-cols-2 md:gap-6 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <li key={f.title} className={cardCls}>
              <h3 className="text-xl leading-[1.3]">{f.title}</h3>
              <p className="text-muted-foreground">{f.body}</p>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
