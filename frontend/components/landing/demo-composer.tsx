import { ArrowUp, Mic, Plus } from "lucide-react";

/** A still picture of the prompt bar's look for the laptop screen. Not the live component: it takes no input. */
export function DemoComposer() {
  return (
    <div aria-hidden className="rounded-[16px] border border-input bg-card px-3 pt-2.5 pb-2">
      <p className="truncate text-xs text-muted-foreground">Check USTRY on Stellar mainnet</p>
      <div className="mt-3 flex items-center justify-between">
        <Plus className="size-4 text-muted-foreground" strokeWidth={1.5} />
        <div className="flex items-center gap-2">
          <Mic className="size-4 text-muted-foreground" strokeWidth={1.5} />
          <span className="flex size-6 items-center justify-center rounded-full bg-primary">
            <ArrowUp className="size-3.5" strokeWidth={1.5} />
          </span>
        </div>
      </div>
    </div>
  );
}
