"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Composer } from "@/components/chat/composer";
import { EmptyState } from "@/components/chat/empty-state";
import { MessageView } from "@/components/chat/message";
import { SectionTitle } from "@/components/chat/section-title";
import { SetupSteps } from "@/components/chat/setup-steps";
import { ToolsList } from "@/components/chat/tools-card";
import { useAgent } from "@/components/chat/use-agent";
import { CallOverlay } from "@/components/call/call-overlay";
import { LiveThought } from "@/components/chat/thinking";

export default function AgentPage() {
  const a = useAgent();
  const bottomRef = useRef<HTMLDivElement>(null);
  const [calling, setCalling] = useState(false);
  const closeCall = useCallback(() => setCalling(false), []);

  useEffect(() => {
    if (a.messages.length > 0 || a.thinking) bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [a.messages, a.thinking]);

  return (
    <main className="mx-auto flex min-h-screen max-w-[1200px] flex-col gap-8 px-4 py-8 sm:px-6 md:px-8 md:py-12">
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3 text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
          <span>Agentmaxxing</span>
          {a.status && <span>Model: {a.status.model}</span>}
        </div>
        <h1 className="text-[40px] leading-none tracking-[-0.03em] md:text-[64px]">Agent</h1>
        <p className="max-w-xl text-lg text-muted-foreground">
          An AI agent that checks tokenized real-world assets against Stellar on-chain data.
        </p>
        <Link href="/en/assets" className="w-fit rounded-[6px] text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground">
          Fact sheets
        </Link>
      </header>

      <div className="grid flex-1 gap-6 lg:grid-cols-[380px_1fr]">
        <aside className="flex min-w-0 flex-col gap-6">
          <Card className="rounded-[16px] shadow-none ring-0 border">
            <CardHeader>
              <SectionTitle num="01" title="Setup" />
            </CardHeader>
            <CardContent>
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
            </CardContent>
          </Card>

          <Card className="rounded-[16px] shadow-none ring-0 border">
            <CardHeader>
              <SectionTitle num="02" title="Tools" />
            </CardHeader>
            <CardContent>
              <ToolsList tools={a.status?.tools} />
            </CardContent>
          </Card>
        </aside>

        <Card className="flex h-[calc(100vh-6rem)] min-h-[560px] min-w-0 flex-col rounded-[16px] shadow-none ring-0 border lg:sticky lg:top-24">
          <CardHeader className="border-b">
            <SectionTitle num="03" title="Chat" />
            <CardAction>
              <Button variant="ghost" size="sm" className="rounded-[6px] font-mono uppercase" onClick={a.clear} disabled={a.messages.length === 0 || a.thinking}>
                <RotateCcw /> Clear
              </Button>
            </CardAction>
          </CardHeader>

          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col gap-5 px-4 py-4">
              {a.messages.length === 0 && <EmptyState ready={a.ready} wallet={a.wallet} onPick={a.send} />}
              {a.messages.map((m, i) => <MessageView key={i} message={m} />)}
              {a.thinking && <LiveThought />}
              <div ref={bottomRef} />
            </div>
          </ScrollArea>

          <CardFooter className="border-t pt-4">
            <Composer onSend={(t) => void a.send(t)} onStop={a.stop} onCall={() => setCalling(true)} ready={a.ready} thinking={a.thinking} />
          </CardFooter>
        </Card>
      </div>
      <CallOverlay open={calling} onClose={closeCall} ask={a.send} />
    </main>
  );
}
