import Link from "next/link";
import { ButtonLink } from "@/components/ui/button-link";
import { Logo } from "./logo";
import { DEMO_HREF, NAV_LINKS } from "./links";

const linkCls = "rounded-[6px] px-3 py-2 text-sm hover:bg-secondary focus-visible:outline-2 focus-visible:outline-foreground";

function NavLink({ link }: { link: (typeof NAV_LINKS)[number] }) {
  return "external" in link ? (
    <a href={link.href} className={linkCls} target="_blank" rel="noopener noreferrer">{link.label}</a>
  ) : (
    <Link href={link.href} className={linkCls}>{link.label}</Link>
  );
}

export function Nav() {
  return (
    <header className="sticky top-0 z-40 border-b bg-card">
      <nav aria-label="Main" className="mx-auto flex h-16 max-w-[1200px] items-center justify-between gap-3 px-4 sm:px-6 md:px-8">
        <Logo />
        <ul className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((l) => (
            <li key={l.label}><NavLink link={l} /></li>
          ))}
        </ul>
        <div className="flex items-center gap-2">
          <details className="group relative md:hidden">
            <summary className="flex h-11 cursor-pointer list-none items-center rounded-[6px] px-3 text-sm hover:bg-secondary focus-visible:outline-2 focus-visible:outline-foreground [&::-webkit-details-marker]:hidden">
              Menu
            </summary>
            <ul className="absolute right-0 mt-2 flex w-48 flex-col gap-1 rounded-[16px] border bg-card p-2">
              {NAV_LINKS.map((l) => (
                <li key={l.label}><NavLink link={l} /></li>
              ))}
            </ul>
          </details>
          <ButtonLink href={DEMO_HREF} className="h-10 px-3 text-sm sm:px-5 sm:text-base">Try the live demo</ButtonLink>
        </div>
      </nav>
    </header>
  );
}
