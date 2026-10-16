import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** A small hairline tile holding one icon. Decorative: the text beside it carries the meaning. */
export function IconTile({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
  return (
    <span aria-hidden className={cn("flex size-10 shrink-0 items-center justify-center rounded-[10px] border bg-card", className)}>
      <Icon className="size-5" strokeWidth={1.5} />
    </span>
  );
}
