import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Centered 1200px column; every section uses it so the left edges line up. */
export function Container({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-[1200px] px-4 sm:px-6 md:px-8", className)}>{children}</div>;
}

/** Centered section title in two tones: the lead in ink, the tail in muted gray. */
export function SectionHeading({ id, lead, tail, className }: { id: string; lead: string; tail: string; className?: string }) {
  return (
    <h2 id={id} className={cn("text-center text-[32px] leading-[1.1] tracking-[-0.02em] text-balance md:text-[44px]", className)}>
      {lead} <span className="text-muted-foreground">{tail}</span>
    </h2>
  );
}

export const cardCls = "flex flex-col gap-3 rounded-[16px] border bg-card p-5 md:p-6";
