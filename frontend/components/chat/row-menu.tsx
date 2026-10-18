"use client";

import { Menu } from "@base-ui/react/menu";
import { MoreVertical } from "lucide-react";
import type { ReactNode } from "react";

export type RowAction = { label: string; icon: ReactNode; onSelect: () => void; destructive?: boolean };

const item = "flex w-full cursor-pointer items-center gap-2 rounded-[6px] px-3 py-2 text-sm outline-none data-[highlighted]:bg-secondary";

/** The three-dot menu at the end of a saved row. Keyboard accessible (arrow keys, Escape) through base-ui's Menu. */
export function RowMenu({ label, actions }: { label: string; actions: RowAction[] }) {
  return (
    <Menu.Root>
      <Menu.Trigger aria-label={label} className="inline-flex size-8 shrink-0 items-center justify-center rounded-[6px] text-muted-foreground hover:bg-secondary focus-visible:outline-2 focus-visible:outline-foreground data-[popup-open]:bg-secondary">
        <MoreVertical className="size-4" aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align="end" sideOffset={4} className="z-50">
          <Menu.Popup className="min-w-44 rounded-[12px] border bg-card p-1 shadow-none outline-none">
            {actions.map((a, i) => (
              <Menu.Item key={a.label} className={`${item} ${a.destructive ? "text-destructive" : ""} ${a.destructive && i > 0 ? "mt-1 border-t pt-2" : ""}`} onClick={a.onSelect}>
                <span aria-hidden="true" className="[&_svg]:size-4">{a.icon}</span>
                {a.label}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
