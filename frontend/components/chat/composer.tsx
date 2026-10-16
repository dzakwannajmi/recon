"use client";

import { useRef } from "react";
import { cn } from "@/lib/utils";
import { PromptField } from "./prompt-input";
import type { PromptAsset } from "./prompt-config";
import type { ChatModelInfo } from "./types";
import { useDictation, useVoiceSupport } from "./use-dictation";

type Props = {
  onSend: (v: string) => void;
  onStop: () => void;
  ready: boolean;
  thinking: boolean;
  assets: PromptAsset[];
  /** The model the server reports. */
  model?: string;
  /** The models the user may pick, and the chosen id. */
  models?: ChatModelInfo[];
  modelId?: string;
  onModelChange?: (id: string) => void;
  /** Show the voice privacy note under the bar (the empty state). */
  showVoiceNote?: boolean;
};

/**
 * One bar: text on top; plus, model, mic and send in the bottom row.
 * The mic is hidden where the browser has no speech recognition.
 */
export function Composer({ onSend, onStop, ready, thinking, assets, model, models, modelId, onModelChange, showVoiceNote }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const support = useVoiceSupport();
  const dictation = useDictation(root);
  const note = "Voice uses your browser's speech service.";

  return (
    <div className="flex w-full flex-col gap-2">
      <div ref={root} inert={!ready} className={cn(!ready && "opacity-50")}>
        <PromptField
          placeholder={ready ? "ask your agent something..." : "add your API key to start"}
          onSend={onSend}
          busy={thinking}
          onStop={onStop}
          assets={assets}
          model={model}
          models={models}
          modelId={modelId}
          onModelChange={onModelChange}
          onDictate={support.dictation ? dictation.dictate : undefined}
          onDictateEnd={dictation.finish}
          micTitle={note}
        />
      </div>
      {support.dictation && showVoiceNote && <p className="px-1 text-xs text-muted-foreground">{note}</p>}
      {dictation.error && <p role="alert" className="px-1 text-xs text-destructive">{dictation.error}</p>}
    </div>
  );
}
