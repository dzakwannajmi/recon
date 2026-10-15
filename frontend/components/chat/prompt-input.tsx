"use client";

import PromptBar from "@/components/effects/PromptBar";
import { cn } from "@/lib/utils";

type Props = {
  placeholder: string;
  onSend: (text: string) => void;
  /** Shows the stop button instead of send. */
  busy?: boolean;
  onStop?: () => void;
  width?: number;
  className?: string;
};

/**
 * The prompt bar in its minimal form: no attachments, no sources, no commands, no model or effort pickers.
 * The bar is configured through its props; the rest (hiding the plus button and the empty menu, a hairline
 * border, a chartreuse send button) is done with selectors here so the vendored file stays as installed.
 */
const MINIMAL = [
  "[&_[role=presentation]]:border [&_[role=presentation]]:border-input",
  "[&_button[aria-label^=Add]]:hidden [&_[role=listbox]]:hidden",
  "[&_button[aria-label=Send]]:size-11 [&_button[aria-label=Send]]:rounded-[8px]",
  "[&_button[aria-label=Send]]:bg-primary! [&_button[aria-label=Send]]:text-foreground!",
  "[&_textarea::placeholder]:text-muted-foreground! [&_button[aria-label=Send]:disabled]:opacity-70 [&_button[aria-label=Stop]]:size-11 [&_button[aria-label=Stop]]:rounded-[8px]",
].join(" ");

export function MinimalPrompt({ placeholder, onSend, busy, onStop, width = 9999, className }: Props) {
  return (
    <PromptBar
      className={cn(MINIMAL, className)}
      placeholder={placeholder}
      sources={[]}
      commands={[]}
      models={[]}
      efforts={[]}
      busy={busy}
      onSend={(text) => onSend(text)}
      onStop={onStop}
      background="#ffffff"
      color="#151515"
      menuBackground="#ffffff"
      width={width}
      radius={12}
      maxRows={4}
    />
  );
}
