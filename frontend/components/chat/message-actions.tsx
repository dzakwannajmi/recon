"use client";

import { Check, Copy, RotateCw, ThumbsDown, ThumbsUp } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type Rating = "up" | "down" | null;

const btn = "inline-flex size-8 items-center justify-center rounded-[6px] text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-foreground disabled:opacity-40 disabled:hover:bg-transparent [&_svg]:size-4";

/**
 * The row under an agent answer: copy the text, like, dislike (each toggles, only one can be on) and run the
 * question again. The rating only lives on this page for now; nothing is sent or saved.
 */
export function MessageActions({ text, onRegenerate }: { text: string; onRegenerate?: () => void }) {
  const [copied, setCopied] = useState(false);
  const [rating, setRating] = useState<Rating>(null);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // Clipboard blocked: leave the button as it was.
    }
  }

  return (
    <div role="group" aria-label="Answer actions" className="-ml-2 flex items-center gap-0.5">
      <button type="button" className={btn} aria-label={copied ? "Copied" : "Copy answer"} title={copied ? "Copied" : "Copy"} onClick={() => void copy()}>
        {copied ? <Check /> : <Copy />}
      </button>
      <button type="button" className={cn(btn, rating === "up" && "text-foreground")} aria-label="Good answer" aria-pressed={rating === "up"} title="Good answer" onClick={() => setRating(rating === "up" ? null : "up")}>
        <ThumbsUp className={rating === "up" ? "fill-current" : ""} />
      </button>
      <button type="button" className={cn(btn, rating === "down" && "text-foreground")} aria-label="Bad answer" aria-pressed={rating === "down"} title="Bad answer" onClick={() => setRating(rating === "down" ? null : "down")}>
        <ThumbsDown className={rating === "down" ? "fill-current" : ""} />
      </button>
      {onRegenerate && (
        <button type="button" className={btn} aria-label="Try again" title="Try again" onClick={onRegenerate}>
          <RotateCw />
        </button>
      )}
    </div>
  );
}
