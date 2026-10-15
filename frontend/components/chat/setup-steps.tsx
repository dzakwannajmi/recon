import type { ReactNode } from "react";
import { Check, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { WalletPanel } from "./wallet-panel";
import { PROVIDER_NAMES, type Message, type Status, type WalletInfo } from "./types";

function Code({ children }: { children: ReactNode }) {
  return <code className="rounded-[6px] bg-secondary px-1 py-0.5 font-mono text-[0.85em] text-foreground">{children}</code>;
}

function SetupStep(props: { number: number; title: string; done: boolean; last?: boolean; children: ReactNode }) {
  return (
    <div className="flex gap-4">
      <div className="flex flex-col items-center">
        <span
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-[6px] border font-mono text-xs",
            props.done ? "border-primary bg-primary text-primary-foreground" : "border-foreground text-foreground"
          )}
        >
          {props.done ? <Check className="size-3.5" strokeWidth={3} aria-label="Done" /> : props.number}
        </span>
        {!props.last && <span className={cn("w-px flex-1", props.done ? "bg-foreground" : "bg-border")} />}
      </div>
      <div className={cn("flex min-w-0 flex-1 flex-col gap-2", !props.last && "pb-6")}>
        <p className="tracking-tight">{props.title}</p>
        {props.children}
      </div>
    </div>
  );
}

type Props = {
  status: Status | null;
  wallet: WalletInfo | null;
  walletError: string | null;
  messages: Message[];
  ready: boolean;
  creating: boolean;
  onCreateWallet: () => void;
  onRefreshWallet: () => void;
};

export function SetupSteps({ status, wallet, walletError, messages, ready, creating, onCreateWallet, onRefreshWallet }: Props) {
  return (
    <div className="flex flex-col">
      <SetupStep number={1} title={`Add your ${PROVIDER_NAMES[status?.provider ?? "google"] ?? status?.provider} API key`} done={ready}>
        {status && !ready && (
          <p className="text-muted-foreground">
            Paste it into <Code>.env</Code> as <Code>{status.keyEnv ?? "GEMINI_API_KEY"}</Code>, then restart <Code>npm run dev</Code>.{" "}
            {(!status.provider || status.provider === "google") && (
              <a className="text-foreground underline underline-offset-4" href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
                Get a free key
              </a>
            )}
          </p>
        )}
        {ready && <p className="text-muted-foreground">Connected.</p>}
      </SetupStep>

      <SetupStep number={2} title="Create the agent wallet" done={Boolean(wallet?.address)}>
        {wallet && !wallet.address && (
          <div className="flex flex-col gap-3">
            <p className="text-muted-foreground">The agent's own Stellar testnet wallet, funded with Friendbot. No real money.</p>
            <Button onClick={onCreateWallet} disabled={creating} className="w-fit font-mono tracking-wider uppercase">
              <Wallet /> {creating ? "Creating..." : "Create wallet"}
            </Button>
            {walletError && <p className="text-xs text-destructive">{walletError}</p>}
          </div>
        )}
        {wallet?.address && <WalletPanel wallet={wallet} onRefresh={onRefreshWallet} />}
      </SetupStep>

      <SetupStep number={3} title="Chat with your agent" done={messages.some((m) => m.role === "agent" && !m.error)} last>
        <p className="text-muted-foreground">Pick an example prompt, or ask anything.</p>
      </SetupStep>
    </div>
  );
}
