"use client";

import { useEffect, useRef } from "react";
import PromptBar from "@/components/effects/PromptBar";
import { cn } from "@/lib/utils";
import type { ChatModelInfo } from "./types";
import { preparePrompt, promptModels, promptSources, PROMPT_COMMANDS, type PromptAsset } from "./prompt-config";

type Props = {
  placeholder: string;
  onSend: (text: string) => void;
  /** Shows the stop button instead of send. */
  busy?: boolean;
  onStop?: () => void;
  assets: PromptAsset[];
  /** The model the server reports (shown read-only when there is no list). */
  model?: string;
  /** The models the user may pick, and the chosen id. */
  models?: ChatModelInfo[];
  modelId?: string;
  onModelChange?: (id: string) => void;
  /** Starts dictation; resolves when the session ends. Leave out where the browser has no speech recognition. */
  onDictate?: () => Promise<void>;
  /** Called when the user taps the mic off. */
  onDictateEnd?: () => void;
  /** Tooltip of the mic button. */
  micTitle?: string;
  width?: number;
  className?: string;
};

/**
 * Recon's prompt bar: the full React Bits bar, filled with real data (see prompt-config.ts).
 * The bar's own look is kept (rounded container, bottom row, morphing send button); only the colours are ours.
 */
const LOOK = [
  // Hairline border on the white bar.
  "[&_[role=presentation]]:border [&_[role=presentation]]:border-input",
  // The asset list is long: scroll it, hairline instead of a shadow.
  "[&_[role=listbox]]:max-h-64 [&_[role=listbox]]:overflow-y-auto [&_[role=listbox]]:border [&_[role=listbox]]:shadow-none",
].join(" ");

// One entry means nothing to choose, so no chevron.
const SINGLE_MODEL = "[&_button[aria-label^=Choose]_svg]:hidden";

export function PromptField({ placeholder, onSend, busy, onStop, assets, model, models: modelList, modelId, onModelChange, onDictate, onDictateEnd, micTitle, width = 9999, className }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const models = promptModels(model, modelList);

  // PromptBar has no title prop for its mic: set it on the button.
  useEffect(() => {
    const mic = root.current?.querySelector<HTMLElement>("button[aria-label=Dictate], button[aria-label='Stop dictation']");
    if (mic && micTitle) mic.title = micTitle;
  }, [micTitle, onDictate]);

  return (
    <div
      ref={root}
      data-prompt-bar=""
      className="w-full"
      // Tapping the mic off is a click on the "Stop dictation" button. The bar drops the pending result then, so close the mic here.
      onClickCapture={(e) => {
        if ((e.target as HTMLElement).closest("button[aria-label='Stop dictation']")) onDictateEnd?.();
      }}
      // The source list scrolls; keep the arrow-key highlight in view.
      onKeyUpCapture={(e) => {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") root.current?.querySelector("[role=option][aria-selected=true]")?.scrollIntoView({ block: "nearest" });
      }}
    >
      <PromptBar
        className={cn(LOOK, models.length <= 1 && SINGLE_MODEL, className)}
        placeholder={placeholder}
        sources={promptSources(assets)}
        commands={PROMPT_COMMANDS}
        models={models}
        modelKey={modelId}
        onModelChange={onModelChange}
        efforts={[]}
        busy={busy}
        onSend={(text) => onSend(preparePrompt(text, assets))}
        onStop={onStop}
        onDictate={onDictate}
        background="#ffffff"
        color="#151515"
        menuBackground="#ffffff"
        sparkColor="#b4f03c"
        width={width}
        radius={16}
        maxRows={4}
      />
    </div>
  );
}
