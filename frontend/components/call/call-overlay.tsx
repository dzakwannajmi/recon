"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import type { Reply } from "@/components/chat/types";
import type { CallPhase } from "@/lib/voice/call-state";
import { Orb } from "./orb";
import { useCall } from "./use-call";

const LABEL: Record<CallPhase, string> = { idle: "Ready", listening: "Listening", thinking: "Thinking", speaking: "Speaking" };

type Props = { open: boolean; onClose: () => void; ask: (text: string) => Promise<Reply> };

/** Full-screen call mode. End and Escape close it, which also stops the mic and the speech. */
export function CallOverlay({ open, onClose, ask }: Props) {
  const call = useCall(open, ask);
  const endRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    endRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      // Only the End button can be focused while the call is open.
      if (e.key === "Tab") {
        e.preventDefault();
        endRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label="Call" className="fixed inset-0 z-50 flex flex-col items-start justify-between gap-6 overflow-y-auto bg-background px-4 py-8 sm:px-6 md:px-8">
      <div className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col items-start justify-center gap-6">
        <Orb phase={call.phase} className="self-center" />
        <p role="status" className="text-[10px] tracking-[0.18em] text-muted-foreground uppercase">{LABEL[call.phase]}</p>
        {call.transcript && <p className="max-w-2xl text-xl leading-[1.3] [overflow-wrap:anywhere]">{call.transcript}</p>}
        {call.reply && call.phase !== "listening" && <p className="max-w-2xl text-muted-foreground [overflow-wrap:anywhere]">{call.reply}</p>}
        {call.error && <p role="alert" className="max-w-2xl text-destructive">{call.error}</p>}
      </div>
      <div className="mx-auto w-full max-w-[1200px]">
        <Button ref={endRef} onClick={onClose} className="h-11 rounded-[6px] px-6">End</Button>
      </div>
    </div>
  );
}
