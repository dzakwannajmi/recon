"use client";

import type { ReactNode } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

type Props = { open: boolean; onClose: () => void; children: ReactNode; title?: string; side?: "right" | "left" };

/** Side sheet for setup and tools. The sheet handles Escape, the backdrop, focus trapping and focus return. */
export function SetupPanel({ open, onClose, children, title = "Setup and tools", side = "right" }: Props) {
  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <SheetContent side={side} className="gap-0 overflow-y-auto border-l bg-card shadow-none data-[side=left]:w-[min(420px,100vw)] data-[side=left]:sm:max-w-[420px] data-[side=right]:w-[min(420px,100vw)] data-[side=right]:sm:max-w-[420px]">
        <SheetHeader className="p-4 sm:p-6">
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <div className="flex flex-col gap-6 px-4 pb-6 sm:px-6">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
