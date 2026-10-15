import Link from "next/link";
import { DEMO_HREF, GITHUB_URL } from "./links";

const link = "rounded-[6px] underline underline-offset-4 hover:bg-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground";
const label = "text-[10px] tracking-[0.18em] text-muted-foreground uppercase";

export function Footer() {
  return (
    <footer className="border-t bg-card">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-10 px-4 py-12 text-sm sm:px-6 md:flex-row md:justify-between md:px-8">
        <div className="flex max-w-2xl flex-col gap-6">
          <section id="scope" aria-labelledby="scope-title" className="scroll-mt-16">
            <h2 id="scope-title" className={label}>Scope</h2>
            <p className="mt-2">
              Non-stablecoin real-world assets on Stellar: tokenized treasuries, funds, bonds, and commodities. Recon reads Stellar mainnet. It writes only to Stellar testnet.
            </p>
          </section>
          <section aria-labelledby="limits-title">
            <h2 id="limits-title" className={label}>Limits</h2>
            <p className="mt-2 text-muted-foreground">
              Recon reads public documents only. Some issuer pages need a browser and cannot be read by a plain fetch, so a missing document can mean we could not read it. A flag shows a difference on a date. It does not say why. Issuer documents are treated as untrusted data.
            </p>
          </section>
          <div className="flex flex-col gap-1 text-muted-foreground">
            <p>Recon verifies issuer claims for tokenized real-world assets on Stellar.</p>
            <p>Nothing here is investment advice.</p>
            <p>Built for the Rise In Agentmaxxing program.</p>
            <p>Code is MIT licensed.</p>
          </div>
        </div>
        <ul className="flex gap-6 md:flex-col md:gap-2">
          <li><a href={GITHUB_URL} className={link} target="_blank" rel="noopener noreferrer">GitHub</a></li>
          <li><Link href="/#scope" className={link}>Scope</Link></li>
          <li><Link href={DEMO_HREF} className={link}>Live demo</Link></li>
        </ul>
      </div>
    </footer>
  );
}
