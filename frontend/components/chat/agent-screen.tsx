"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { RotateCcw, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PromptAsset } from "@/components/chat/prompt-config";
import { ChatView } from "@/components/chat/chat-view";
import { Logo } from "@/components/layout/logo";
import { Composer } from "@/components/chat/composer";
import { SectionTitle } from "@/components/chat/section-title";
import { SetupPanel } from "@/components/chat/setup-panel";
import { SetupSteps } from "@/components/chat/setup-steps";
import { ToolsList } from "@/components/chat/tools-card";
import { useAgent } from "@/components/chat/use-agent";

export function AgentScreen({ assets }: { assets: PromptAsset[] }) {
  const a = useAgent();
  const [setupOpen, setSetupOpen] = useState(false);
  const closeSetup = useCallback(() => setSetupOpen(false), []);

  return (
    <main className="h-dvh w-full">
      <h1 className="sr-only">Agent</h1>
      <ChatView
        messages={a.messages}
        thinking={a.thinking}
        ready={a.ready}
        wallet={a.wallet}
        brand={<Logo label="Back to home" />}
        column="max-w-[760px]"
        onPick={(t) => void a.send(t)}
        headerActions={
          <>
            <Button variant="ghost" size="sm" className="rounded-[6px]" onClick={() => setSetupOpen(true)}>
              <Settings2 /> Setup and tools
            </Button>
            <Button variant="ghost" size="sm" className="rounded-[6px] font-mono uppercase" onClick={a.clear} disabled={a.messages.length === 0 || a.thinking}>
              <RotateCcw /> Clear
            </Button>
          </>
        }
        composer={<Composer onSend={(t) => void a.submit(t)} onStop={a.stop} ready={a.ready} thinking={a.thinking} assets={assets} model={a.status?.model} models={a.status?.models} modelId={a.modelId} onModelChange={a.setModelId} showVoiceNote={a.messages.length === 0} />}
      />

      <SetupPanel open={setupOpen} onClose={closeSetup}>
        <div className="flex flex-col gap-2 text-sm text-muted-foreground">
          <p>An AI agent that checks tokenized real-world assets against Stellar on-chain data.</p>
          {a.status && <p className="text-[10px] tracking-[0.18em] uppercase">Model: {a.status.model}</p>}
          <Link href="/en/assets" className="w-fit rounded-[6px] text-foreground underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground">
            Fact sheets
          </Link>
        </div>
        <section className="flex flex-col gap-4">
          <SectionTitle num="01" title="Setup" />
          <SetupSteps
            status={a.status}
            wallet={a.wallet}
            walletError={a.walletError}
            messages={a.messages}
            ready={a.ready}
            creating={a.creating}
            onCreateWallet={a.createWallet}
            onRefreshWallet={a.loadWallet}
          />
        </section>
        <section className="flex flex-col gap-4">
          <SectionTitle num="02" title="Tools" />
          <ToolsList tools={a.status?.tools} />
        </section>
      </SetupPanel>

    </main>
  );
}
