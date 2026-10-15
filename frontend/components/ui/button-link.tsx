import Link from "next/link";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const base =
  "inline-flex h-11 items-center justify-center rounded-[6px] px-5 text-base whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground";
const variants = {
  primary: "bg-primary text-foreground hover:bg-[#a3dc2f]",
  outline: "border border-foreground text-foreground hover:bg-secondary",
};

/** A link styled like the design system's buttons: chartreuse primary, ink-outlined secondary. */
export function ButtonLink({ variant = "primary", className, ...props }: ComponentProps<typeof Link> & { variant?: keyof typeof variants }) {
  return <Link className={cn(base, variants[variant], className)} {...props} />;
}
