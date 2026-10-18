import Link from "next/link";
import { DarkLink } from "@/components/ui/button-link";
import { UserMenu } from "@/components/auth/user-menu";
import { Logo } from "./logo";
import { FeedButton, FeedMenuItem } from "./feed-link";
import { DEMO_HREF, NAV_LINKS } from "./links";

const linkCls = "rounded-[6px] px-3 py-2 text-sm hover:bg-secondary focus-visible:outline-2 focus-visible:outline-foreground";
const btnCls = "h-10 px-4 text-sm";

function NavLink({ link }: { link: (typeof NAV_LINKS)[number] }) {
  return <Link href={link.href} className={linkCls}>{link.label}</Link>;
}

/** Logo and links on the left, two buttons on the right (chartreuse, ink). */
export function Nav() {
  return (
    <header className="sticky top-0 z-40 border-b bg-card">
      <nav aria-label="Main" className="mx-auto flex h-16 max-w-[1400px] items-center gap-3 px-4 sm:px-6 md:gap-8 md:px-8">
        <Logo />
        <ul className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((l) => (
            <li key={l.label}><NavLink link={l} /></li>
          ))}
        </ul>
        <div className="ml-auto flex items-center gap-2">
          <details className="group relative md:hidden">
            <summary className="flex h-11 cursor-pointer list-none items-center rounded-[6px] px-3 text-sm hover:bg-secondary focus-visible:outline-2 focus-visible:outline-foreground [&::-webkit-details-marker]:hidden">
              Menu
            </summary>
            <ul className="absolute right-0 mt-2 flex w-48 flex-col gap-1 rounded-[16px] border bg-card p-2">
              {NAV_LINKS.map((l) => (
                <li key={l.label}><NavLink link={l} /></li>
              ))}
              <FeedMenuItem className={linkCls} />
            </ul>
          </details>
          <FeedButton className={`${btnCls} hidden sm:inline-flex`} />
          <DarkLink href={DEMO_HREF} className={btnCls}>Ask the agent</DarkLink>
          <UserMenu />
        </div>
      </nav>
    </header>
  );
}
