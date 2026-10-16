import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const base =
  "inline-flex h-11 items-center justify-center rounded-[6px] text-base whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground";

/** Chartreuse primary button, as a link. */
export function ButtonLink({ className, ...props }: ComponentProps<typeof Link>) {
  return <Link className={cn(base, "bg-primary px-5 text-foreground hover:bg-[#a3dc2f]", className)} {...props} />;
}

/** The quiet secondary action: ink text, a chevron, no border. */
export function GhostLink({ className, children, ...props }: ComponentProps<typeof Link>) {
  return (
    <Link className={cn(base, "gap-1 px-3 text-foreground hover:bg-secondary", className)} {...props}>
      {children}
      <ChevronRight aria-hidden className="size-4" />
    </Link>
  );
}
