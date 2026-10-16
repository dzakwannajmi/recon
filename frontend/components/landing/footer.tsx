import Link from "next/link";
import { GITHUB_URL, DEMO_HREF, FACT_SHEETS_HREF } from "@/components/layout/links";
import { Container } from "./container";

const X_URL = "https://x.com/reconagent";

const linkCls =
  "w-fit rounded-[6px] hover:underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground";

type FooterLink = { label: string; href: string; external?: boolean };

const COLUMNS: { title: string; links: FooterLink[] }[] = [
  {
    title: "Product",
    links: [
      { label: "Ask the agent", href: DEMO_HREF },
      { label: "Fact sheets", href: FACT_SHEETS_HREF },
      { label: "Fact sheets in Indonesian", href: "/id/assets" },
    ],
  },
  {
    title: "How it works",
    links: [
      { label: "Why Recon", href: "/#why-recon" },
      { label: "How it works", href: "/#how-it-works" },
      { label: "Key features", href: "/#key-features" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "GitHub", href: GITHUB_URL, external: true },
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

/** Full-width footer band: link columns, the logo mark, and one line of small print. */
export function Footer() {
  return (
    <footer className="border-t bg-card py-10 md:py-14">
      <Container>
        <div className="flex flex-col gap-16 md:gap-24">
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
              <a href={X_URL} target="_blank" rel="noopener noreferrer" aria-label="X (Twitter)" className={`${linkCls} flex items-center`}>
                <XIcon />
              </a>
            </div>
          </nav>

          <div className="flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
            <img src="/logo-mark.svg" alt="" width={140} height={140} className="size-24 md:size-[140px]" />
            <p className="text-xs text-muted-foreground md:text-right">© 2026 Recon. MIT License.</p>
          </div>
        </div>
      </Container>
    </footer>
  );
}
