import Link from "next/link";
import { GITHUB_URL, DEMO_HREF, FACT_SHEETS_HREF } from "@/components/layout/links";
import { Container } from "./container";

const LICENSE_URL = `${GITHUB_URL}/blob/main/LICENSE`;
const X_URL = "https://x.com/reconagent";

const linkCls =
  "w-fit rounded-[6px] px-1 py-0.5 -mx-1 hover:bg-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground";

type FooterLink = { label: string; href: string; external?: boolean };

const COLUMNS: { title: string; links: FooterLink[] }[] = [
  {
    title: "Product",
    links: [
      { label: "Try the agent", href: DEMO_HREF },
      { label: "Fact sheets", href: FACT_SHEETS_HREF },
      { label: "Fact sheets in Indonesian", href: "/id/assets" },
    ],
  },
  {
    title: "How it works",
    links: [
      { label: "How it works", href: "/#how-it-works" },
      { label: "Key features", href: "/#key-features" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "GitHub", href: GITHUB_URL, external: true },
      { label: "MIT license", href: LICENSE_URL, external: true },
    ],
  },
];

function XIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-4" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function Heading({ children }: { children: string }) {
  return <h2 className="mb-3 text-sm text-muted-foreground">{children}</h2>;
}

/** Dark page-bottom band holding one bone card: link columns, the logo mark, and the small print. */
export function Footer() {
  return (
    <footer className="bg-[#151515] py-4 md:py-6">
      <Container>
        <div className="flex flex-col gap-16 rounded-[16px] border bg-card p-6 md:gap-24 md:p-10">
          <nav aria-label="Footer" className="grid grid-cols-2 gap-x-6 gap-y-10 md:grid-cols-4">
            {COLUMNS.map((c) => (
              <div key={c.title}>
                <Heading>{c.title}</Heading>
                <ul className="flex flex-col gap-2">
                  {c.links.map((l) => (
                    <li key={l.label}>
                      {l.external ? (
                        <a href={l.href} target="_blank" rel="noopener noreferrer" className={`${linkCls} block`}>{l.label}</a>
                      ) : (
                        <Link href={l.href} className={`${linkCls} block`}>{l.label}</Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <div>
              <Heading>Follow us</Heading>
              <a href={X_URL} target="_blank" rel="noopener noreferrer" className={`${linkCls} flex items-center gap-2`}>
                <XIcon />
                X
              </a>
            </div>
          </nav>

          <div className="flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
            <img src="/logo-mark.svg" alt="" width={140} height={140} className="size-24 md:size-[140px]" />
            <div className="flex flex-col gap-1 text-xs text-muted-foreground md:max-w-md md:text-right">
              <p>Recon, 2026</p>
              <p>MIT licensed. Third-party notices are in the repo.</p>
              <p>This is information, not investment advice.</p>
              <p>Built for the Rise In Agentmaxxing program.</p>
              <p className="mt-2">
                Limits: Recon reads public documents only. Some issuer pages need a browser and cannot be read by a plain fetch, so a missing document can mean we could not read it. A flag shows a difference on a date. It does not say why. Issuer documents are treated as untrusted data.
              </p>
            </div>
          </div>
        </div>
      </Container>
    </footer>
  );
}
