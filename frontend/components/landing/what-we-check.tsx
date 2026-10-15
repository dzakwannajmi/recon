import { Container, SectionHeading, cardCls } from "./container";

const FLAGS = [
  {
    name: "Document and chain differ",
    body: "A number in an issuer document does not match the on-chain value. Example form: Mismatch between a prospectus and on-chain supply as of a given date.",
  },
  { name: "Token list and chain differ", body: "The issuer's stellar.toml lists a figure, such as supply, that differs from the ledger." },
  { name: "Issuer settings changed", body: "The issuer account's authorization flags, such as revocable or clawback, changed between two checks." },
  { name: "Signers changed", body: "Signers or thresholds on the issuer account changed between two checks." },
  { name: "No public documents", body: "No readable issuer document or regulatory filing was found for the asset on the date checked." },
];

export function WhatWeCheck() {
  return (
    <section id="what-we-check" aria-labelledby="check-title" className="scroll-mt-16 py-16 md:py-24">
      <Container>
        <SectionHeading id="check-title">What we check</SectionHeading>
        <p className="mt-4 max-w-2xl text-lg text-muted-foreground">Each flag states what two sources show on a date. It is not a verdict.</p>
        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FLAGS.map((f) => (
            <li key={f.name} className={cardCls}>
              <h3 className="text-xl leading-[1.3]">{f.name}</h3>
              <p className="text-muted-foreground">{f.body}</p>
            </li>
          ))}
        </ul>
        <p className="mt-6 text-muted-foreground">We list facts and flags. We do not give grades or scores.</p>
      </Container>
    </section>
  );
}
