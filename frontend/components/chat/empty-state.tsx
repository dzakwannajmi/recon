import { cn } from "@/lib/utils";
import { EXAMPLES, type WalletInfo } from "./types";

type Props = { ready: boolean; wallet: WalletInfo | null; onPick: (text: string) => void; compact?: boolean };

/** Greeting and the example prompts as pill chips. Props only. */
export function EmptyState({ ready, wallet, onPick, compact }: Props) {
  return (
    <div className={cn("flex flex-1 flex-col items-center justify-center text-center", compact ? "gap-3 py-4" : "gap-6 py-10")}>
      <div>
        <p className={cn("tracking-tight", compact ? "text-base" : "text-3xl")}>Ask the agent something</p>
        <p className={cn("mt-1 text-muted-foreground", compact && "text-xs")}>
          {!ready ? "Add your API key to start." : "Pick an example to start."}
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {EXAMPLES.map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => onPick(e)}
            disabled={!ready}
            className={cn(
              "rounded-full border bg-card text-left hover:bg-secondary focus-visible:outline-2 focus-visible:outline-foreground disabled:pointer-events-none disabled:opacity-50",
              compact ? "px-2.5 py-1 text-[11px]" : "px-4 py-2 text-sm"
            )}
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}
