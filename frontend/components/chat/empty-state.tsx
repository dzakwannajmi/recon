import { Button } from "@/components/ui/button";
import { EXAMPLES, type WalletInfo } from "./types";

type Props = { ready: boolean; wallet: WalletInfo | null; onPick: (text: string) => void };

export function EmptyState({ ready, wallet, onPick }: Props) {
  return (
    <div className="flex flex-col items-start gap-5 py-10">
      <div>
        <p className="text-2xl tracking-tight">Ask the agent something</p>
        <p className="mt-1 text-muted-foreground">
          {!ready ? "Add your API key to start." : wallet && !wallet.address ? "Tip: create the wallet first so the agent can use it." : "Pick an example to start."}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {EXAMPLES.map((e) => (
          <Button key={e} variant="outline" onClick={() => onPick(e)} disabled={!ready} className="h-auto min-h-8 rounded-[6px] py-1.5 text-left whitespace-normal">
            {e}
          </Button>
        ))}
      </div>
    </div>
  );
}
