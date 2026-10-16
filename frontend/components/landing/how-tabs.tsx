"use client";

import { useRef, useState } from "react";
import { FileSearch, Rss, ShieldCheck } from "lucide-react";
import { StatusBadge } from "@/components/factsheet/badges";
import { cn } from "@/lib/utils";
import { IconTile } from "./icon-tile";
import { nextTab, type Row } from "./tabs";

const ICONS = [FileSearch, ShieldCheck, Rss];

type Step = { title: string; body: string; rows: Row[] };

/** Three tabs and one framed panel. Arrow keys, Home and End move between tabs; the selected tab is the only one in the tab order. */
export function HowTabs({ steps, sample }: { steps: Step[]; sample: string | null }) {
  const [active, setActive] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const step = steps[active];

  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    const to = nextTab(i, e.key, steps.length);
    if (to === null) return;
    e.preventDefault();
    setActive(to);
    tabs.current[to]?.focus();
  };

  return (
    <div className="mt-10 md:mt-14">
      <div role="tablist" aria-label="How it works" className="mx-auto grid max-w-3xl grid-cols-3 gap-2 sm:gap-4">
        {steps.map((s, i) => {
          const Icon = ICONS[i];
          const on = i === active;
          return (
            <button
              key={s.title}
              ref={(el) => { tabs.current[i] = el; }}
              type="button"
              role="tab"
              id={`how-tab-${i}`}
              aria-selected={on}
              aria-controls="how-panel"
              tabIndex={on ? 0 : -1}
              onClick={() => setActive(i)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className="flex flex-col items-center gap-2 rounded-[12px] p-2 text-center text-xs leading-[1.3] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground sm:text-sm"
            >
              <IconTile icon={Icon} className={cn("size-12 transition-colors", on ? "border-foreground bg-primary" : "hover:bg-secondary")} />
              <span className={on ? "text-foreground" : "text-muted-foreground"}>{s.title}</span>
            </button>
          );
        })}
      </div>

      {/* Outer frame with an inset panel, as in the reference. */}
      <div className="mx-auto mt-8 max-w-4xl rounded-[24px] border bg-secondary p-2 sm:p-3">
        <div id="how-panel" role="tabpanel" aria-labelledby={`how-tab-${active}`} tabIndex={0} className="rounded-[16px] border bg-card p-5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground md:p-8">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="rounded-[6px] border bg-secondary px-2 py-1 text-xs">{step.title}</span>
            {sample && <span className="text-xs text-muted-foreground">{sample}</span>}
          </div>
          <p className="mt-5 text-lg leading-[1.3] md:text-xl">{step.body}</p>
          {step.rows.length > 0 && (
            <dl className="mt-6 flex flex-col gap-4 rounded-[12px] border bg-background p-4 md:p-5">
              {step.rows.map((r) => (
                <div key={r.label} className="flex flex-col gap-1 sm:flex-row sm:gap-4">
                  <dt className="w-32 shrink-0 text-xs text-muted-foreground sm:pt-0.5">{r.label}</dt>
                  <dd className={cn("min-w-0 break-words", r.mono && "font-mono text-xs break-all", !r.mono && "text-sm")}>
                    {r.status ? <StatusBadge status={r.status} unpublished="" /> : r.value}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>
    </div>
  );
}
