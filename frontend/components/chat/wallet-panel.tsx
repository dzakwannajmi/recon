import { useState } from "react";
import { Check, Copy, ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { WalletInfo } from "./types";

export function WalletPanel({ wallet, onRefresh }: { wallet: WalletInfo; onRefresh: () => void }) {
  const [copied, setCopied] = useState(false);
  const address = wallet.address!;

  function copy() {
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const link = "inline-flex items-center gap-1 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-foreground";

  return (
    <div className="flex flex-col gap-3 rounded-[10px] border bg-background p-3">
      <div className="flex items-center justify-between gap-2">
        <code className="truncate font-mono text-xs text-foreground">{address}</code>
        <Button variant="ghost" size="icon-xs" onClick={copy} aria-label="Copy address">
          {copied ? <Check /> : <Copy />}
        </Button>
      </div>
      <div className="flex items-center justify-between font-mono text-xs text-muted-foreground uppercase">
        <span>
          Balance <span className="text-foreground">{wallet.balance}</span>
        </span>
        <Button variant="ghost" size="icon-xs" onClick={onRefresh} aria-label="Refresh balance">
          <RefreshCw />
        </Button>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t pt-3 font-mono text-xs uppercase">
        <a className={link} href={`https://stellar.expert/explorer/testnet/account/${address}`} target="_blank" rel="noreferrer">
          Explorer <ExternalLink className="size-3" />
        </a>
        <a className={link} href={`https://friendbot.stellar.org?addr=${address}`} target="_blank" rel="noreferrer">
          Fund with Friendbot <ExternalLink className="size-3" />
        </a>
      </div>
      <p className="text-xs text-muted-foreground">Stellar testnet only.</p>
    </div>
  );
}
