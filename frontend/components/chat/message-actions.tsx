"use client";

import { Check, Copy, RotateCw, ThumbsDown, ThumbsUp } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/use-auth";
import { browserClient } from "@/lib/auth/client";
import { toFeedbackRow } from "@/lib/history/rows";
import { deleteFeedback, saveFeedback } from "@/lib/history/store";
import { cn } from "@/lib/utils";
import { FeedbackDialog, type FeedbackInput } from "./feedback-dialog";

type Rating = "up" | "down" | null;

const btn = "inline-flex size-8 items-center justify-center rounded-[6px] text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-foreground disabled:opacity-40 disabled:hover:bg-transparent [&_svg]:size-4";

/**
 * The row under an agent answer: copy the text, like, dislike (each toggles, only one can be on) and run the
 * question again. A thumb opens a box for an optional reason and note; sending saves the rating to the user's
 * account (message_feedback). Pressing the active thumb again takes the rating back.
 */
export function MessageActions({ text, onRegenerate }: { text: string; onRegenerate?: () => void }) {
  const [copied, setCopied] = useState(false);
  const [rating, setRating] = useState<Rating>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [asking, setAsking] = useState<Exclude<Rating, null> | null>(null);
  const { user } = useAuth();

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

  async function rate(kind: Exclude<Rating, null>, input: FeedbackInput): Promise<boolean> {
    const db = browserClient();
    if (!db || !user) return false;
    try {
      if (saved) await deleteFeedback(db, saved);
      const id = crypto.randomUUID();
      await saveFeedback(db, toFeedbackRow(user.id, id, kind === "up" ? 1 : -1, text, input));
      setSaved(id);
      setRating(kind);
      setAsking(null);
      return true;
    } catch {
      return false;
    }
  }

  async function undo() {
    const db = browserClient();
    try {
      if (db && saved) await deleteFeedback(db, saved);
    } catch {
      // The rating row could not be removed; the thumb is still cleared on screen.
    }
    setSaved(null);
    setRating(null);
  }

  return (
    <div role="group" aria-label="Answer actions" className="-ml-2 flex items-center gap-0.5">
      <button type="button" className={btn} aria-label={copied ? "Copied" : "Copy answer"} title={copied ? "Copied" : "Copy"} onClick={() => void copy()}>
        {copied ? <Check /> : <Copy />}
      </button>
      <button type="button" className={cn(btn, rating === "up" && "text-foreground")} aria-label="Good answer" aria-pressed={rating === "up"} title="Good answer" onClick={() => (rating === "up" ? void undo() : setAsking("up"))}>
        <ThumbsUp className={rating === "up" ? "fill-current" : ""} />
      </button>
      <button type="button" className={cn(btn, rating === "down" && "text-foreground")} aria-label="Bad answer" aria-pressed={rating === "down"} title="Bad answer" onClick={() => (rating === "down" ? void undo() : setAsking("down"))}>
        <ThumbsDown className={rating === "down" ? "fill-current" : ""} />
      </button>
      <FeedbackDialog key={asking ?? "none"} kind={asking ?? "up"} open={asking !== null} onClose={() => setAsking(null)} onSend={(input) => rate(asking ?? "up", input)} />
      {onRegenerate && (
        <button type="button" className={btn} aria-label="Try again" title="Try again" onClick={onRegenerate}>
          <RotateCw />
        </button>
      )}
    </div>
  );
}
