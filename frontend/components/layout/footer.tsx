import Link from "next/link";
import { DEMO_HREF, GITHUB_URL } from "./links";

const link = "rounded-[6px] underline underline-offset-4 hover:bg-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground";

export function Footer() {
  return (
    <footer className="border-t bg-card">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-6 px-4 py-12 text-sm sm:px-6 md:flex-row md:justify-between md:px-8">
        <div className="flex max-w-xl flex-col gap-2">
          <p>Recon verifies issuer claims for tokenized real-world assets on Stellar.</p>
          <p className="text-muted-foreground">Nothing here is investment advice.</p>
          <p className="text-muted-foreground">Built for the Rise In Agentmaxxing program.</p>
          <p className="text-muted-foreground">Code is MIT licensed.</p>
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
