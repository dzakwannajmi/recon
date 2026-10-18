"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { History, RotateCcw, Settings2 } from "lucide-react";
import { LoginCard } from "@/components/auth/login-card";
import { UserMenu } from "@/components/auth/user-menu";
import { useAuth } from "@/components/auth/use-auth";
import { Button } from "@/components/ui/button";
import type { PromptAsset } from "@/components/chat/prompt-config";
import { ChatView } from "@/components/chat/chat-view";
import { Logo } from "@/components/layout/logo";
import { Composer } from "@/components/chat/composer";
import { SectionTitle } from "@/components/chat/section-title";
import { SetupPanel } from "@/components/chat/setup-panel";
import { SetupSteps } from "@/components/chat/setup-steps";
import { ToolsList } from "@/components/chat/tools-card";
import { HistoryList } from "@/components/chat/history-list";
import { useAgent } from "@/components/chat/use-agent";
import { useHistory } from "@/components/chat/use-history";

export function AgentScreen({ assets }: { assets: PromptAsset[] }) {
  const auth = useAuth();
  // The model id is only a label on the saved chat; the history hook is told after the agent hook is built.
  const modelRef = useRef<string | null>(null);
  const history = useHistory(auth.user, modelRef.current);
  const a = useAgent({ signedIn: auth.status === "in", onExchange: history.record });
  modelRef.current = a.modelId ?? null;
  const [setupOpen, setSetupOpen] = useState(false);
  const [savedOpen, setSavedOpen] = useState(false);
  const closeSetup = useCallback(() => setSetupOpen(false), []);
  const closeSaved = useCallback(() => setSavedOpen(false), []);
  const signedIn = auth.status === "in";
  // With AUTH_REQUIRED on and nobody signed in, the chat is replaced by a sign-in gate (once both facts are known).
  const gated = a.needsSignIn && a.status !== null && auth.status !== "loading";

  const list = (
    <HistoryList
      sessions={history.sessions}
      evidence={history.evidence}
      current={history.current}
      error={history.error}
      busy={a.thinking}
      onNew={() => { a.clear(); history.startNew(); setSavedOpen(false); }}
      onOpen={async (id) => {
        const m = await history.open(id);
        if (m) { a.load(m); setSavedOpen(false); }
      }}
      onRemove={async (id) => {
        const wasOpen = history.current === id;
        await history.remove(id);
        if (wasOpen) a.clear();
      }}
      onRename={(id, title) => void history.rename(id, title)}
      onPin={(id, pinned) => void history.pin(id, pinned)}
      onRemoveEvidence={(id) => void history.removeEvidence(id)}
    />
  );

  if (gated) {
    return (
      <main className="flex h-dvh w-full flex-col">
        <h1 className="sr-only">Agent</h1>
        <header className="flex h-14 shrink-0 items-center border-b px-4 sm:px-6"><Logo label="Back to home" /></header>
        <div className="flex flex-1 flex-col justify-center px-4"><LoginCard /></div>
      </main>
    );
  }

  return (
    <main className="flex h-dvh w-full">
      <h1 className="sr-only">Agent</h1>
      {signedIn && <aside aria-label="Saved items" className="hidden w-72 shrink-0 overflow-y-auto border-r p-4 lg:block">{list}</aside>}
      <div className="h-full min-w-0 flex-1">
      <ChatView
        messages={a.messages}
        onRegenerate={() => void a.regenerate()}
        thinking={a.thinking}
        ready={a.ready}
        wallet={a.wallet}
        brand={<Logo label="Back to home" />}
        column="max-w-[760px]"
        onPick={(t) => void a.send(t)}
        headerActions={
          <>
            {signedIn && (
              <Button variant="ghost" size="sm" className="rounded-[6px] lg:hidden" onClick={() => setSavedOpen(true)}>
                <History /> Saved
              </Button>
            )}
            <Button variant="ghost" size="sm" className="rounded-[6px]" onClick={() => setSetupOpen(true)}>
              <Settings2 /> Setup and tools
            </Button>
            <Button variant="ghost" size="sm" className="rounded-[6px] font-mono uppercase" onClick={() => { a.clear(); history.startNew(); }} disabled={a.messages.length === 0 || a.thinking}>
              <RotateCcw /> Clear
            </Button>
            <UserMenu />
          </>
        }
        composer={<Composer onSend={(t) => void a.submit(t)} onStop={a.stop} ready={a.ready} thinking={a.thinking} assets={assets} model={a.status?.model} models={a.status?.models} modelId={a.modelId} onModelChange={a.setModelId} showVoiceNote={a.messages.length === 0} />}
      />
      </div>

      <SetupPanel open={savedOpen} onClose={closeSaved} title="Saved" side="left">{list}</SetupPanel>
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
