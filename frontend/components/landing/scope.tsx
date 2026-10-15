import { loadLandingStats } from "@/lib/factsheet/stats";
import { Container, SectionHeading } from "./container";

export function Scope() {
  const { assets, issuers, asOf } = loadLandingStats();
  return (
    <section id="scope" aria-labelledby="scope-title" className="scroll-mt-16 py-16 md:py-24">
      <Container className="grid gap-8 md:grid-cols-[1fr_2fr] md:gap-12">
        <SectionHeading id="scope-title">Scope</SectionHeading>
        <div className="flex max-w-2xl flex-col gap-4 text-lg">
          <p>Non-stablecoin real-world assets on Stellar: tokenized treasuries, funds, bonds, and commodities. Yield-bearing dollar products are included and labeled yield-bearing.</p>
          <p>Stablecoins are out of scope.</p>
          <p>Today the list holds {assets} assets from {issuers} issuers. Data as of {asOf}.</p>
          <p>Recon reads Stellar mainnet. It writes only to Stellar testnet.</p>
        </div>
      </Container>
    </section>
  );
}
