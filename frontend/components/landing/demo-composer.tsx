import { ArrowUp, Mic, Plus } from "lucide-react";

/** A still picture of the prompt bar's look for the laptop screen. Not the live component: it takes no input. */
export function DemoComposer() {
  return (
    <div aria-hidden className="rounded-[16px] border border-input bg-card px-4 pt-4 pb-3">
      <p className="truncate text-[17px] text-muted-foreground">Check USTRY on Stellar mainnet</p>
      <div className="mt-5 flex items-center justify-between">
        <Plus className="size-5 text-muted-foreground" strokeWidth={1.5} />
        <div className="flex items-center gap-3">
          <Mic className="size-5 text-muted-foreground" strokeWidth={1.5} />
          <span className="flex size-8 items-center justify-center rounded-full bg-primary">
            <ArrowUp className="size-4" strokeWidth={1.5} />
          </span>
        </div>
      </div>
    </div>
  );
}
