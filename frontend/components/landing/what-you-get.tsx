import Link from "next/link";
import { Container, SectionHeading, cardCls } from "./container";

const ITEMS = [
  {
    title: "A fact sheet",
    href: "/en/assets",
    body: "For each asset: the claims found, each with its quote, source link, page, and document hash. Flags are listed with dates and evidence.",
  },
  { title: "An on-chain feed", body: "The same results as entries in a Soroban contract on Stellar testnet." },
  { title: "Agent access", body: "Other agents can query checks through an MCP endpoint. A detailed check can settle through x402 on Stellar testnet." },
];

export function WhatYouGet() {
  return (
    <section id="what-you-get" aria-labelledby="get-title" className="scroll-mt-16 py-16 md:py-24">
      <Container>
        <SectionHeading id="get-title">What you get</SectionHeading>
        <ul className="mt-10 grid gap-4 md:grid-cols-3">
          {ITEMS.map((it) => (
            <li key={it.title} className={cardCls}>
              <h3 className="text-xl leading-[1.3]">
                {it.href ? (
                  <Link href={it.href} className="rounded-[6px] underline decoration-primary decoration-[3px] underline-offset-4 hover:bg-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground">
                    {it.title}
                  </Link>
                ) : (
                  it.title
                )}
              </h3>
              <p className="text-muted-foreground">{it.body}</p>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
