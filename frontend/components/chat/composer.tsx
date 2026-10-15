"use client";

import { useRef } from "react";
import { Phone } from "lucide-react";
import VoicePill from "@/components/effects/VoicePill";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MinimalPrompt } from "./prompt-input";
import { useDictation, useVoiceSupport } from "./use-dictation";

type Props = {
  onSend: (v: string) => void;
  onStop: () => void;
  onCall: () => void;
  ready: boolean;
  thinking: boolean;
};

/** Prompt bar, a dictation pill, and the call button. The mic controls are hidden where the browser has no speech recognition. */
export function Composer({ onSend, onStop, onCall, ready, thinking }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const support = useVoiceSupport();
  const dictation = useDictation(root);

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex flex-wrap items-end justify-end gap-2">
        <div ref={root} inert={!ready} className={cn("min-w-0 basis-full sm:basis-0 sm:flex-1", !ready && "opacity-50")}>
          <MinimalPrompt
            placeholder={ready ? "ask your agent something..." : "add your API key to start"}
            onSend={onSend}
            busy={thinking}
            onStop={onStop}
          />
        </div>
        {support.dictation && (
          <div className="flex h-11 shrink-0 items-center">
            <VoicePill
              key={dictation.pillKey}
              mode="toggle"
              size={44}
              shape="rounded"
              background="#ebe8e4"
              accentColor="#151515"
              iconColor="#151515"
              slideToCancel={false}
              disabled={!ready}
              ariaLabel="Dictate"
              onStart={dictation.start}
              onStop={dictation.finish}
            />
          </div>
        )}
        {support.call && (
          <Button variant="outline" className="h-11 shrink-0 rounded-[6px] px-4" onClick={onCall} disabled={!ready || thinking}>
            <Phone /> Call
          </Button>
        )}
      </div>
      {support.dictation && <p className="text-xs text-muted-foreground">Voice uses your browser&apos;s speech service.</p>}
      {dictation.error && <p role="alert" className="text-xs text-destructive">{dictation.error}</p>}
    </div>
  );
}
