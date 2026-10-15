import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Centered 1200px column; every section uses it so the left edges line up. */
export function Container({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-[1200px] px-4 sm:px-6 md:px-8", className)}>{children}</div>;
}

export function SectionHeading({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="text-[32px] leading-[1.05] tracking-[-0.02em] md:text-[40px]">
      {children}
    </h2>
  );
}

export const cardCls = "flex flex-col gap-3 rounded-[16px] border bg-card p-5 md:p-6";
