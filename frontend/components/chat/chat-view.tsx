"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { EmptyState } from "./empty-state";
import { MessageView } from "./message";
import { LiveThought } from "./thinking";
import type { Message, WalletInfo } from "./types";

type Props = {
  messages: Message[];
  thinking: boolean;
  /** The agent has an API key. Drives the status dot and the example chips. */
  ready: boolean;
  wallet?: WalletInfo | null;
  onPick: (text: string) => void;
  /** Pinned at the bottom: the prompt bar and its controls. */
  composer: ReactNode;
  /** Buttons at the right end of the header row. */
  headerActions?: ReactNode;
  className?: string;
  /** Smaller type and padding, for a small fixed-size container. */
  compact?: boolean;
  /** Replaces the logo mark at the left of the header, e.g. a link home. */
  brand?: ReactNode;
  /** Classes for the centered column that holds the messages and the composer (width, gap). */
  column?: string;
};

/**
 * The chat screen, from props only: header row, message list, empty state, composer slot.
 * It fills its parent (h-full) and scrolls the list, so it fits a page column or a small screen mockup.
 */
export function ChatView({ messages, thinking, ready, wallet = null, onPick, composer, headerActions, className, compact, brand, column }: Props) {
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = list.current;
    if (el && (messages.length > 0 || thinking)) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, thinking]);

  const pad = compact ? "px-3" : "px-4 sm:px-6";
  return (
    <section aria-label="Chat" className={cn("flex h-full min-h-0 w-full flex-col bg-background", compact && "text-xs", className)}>
      <header className={cn("flex shrink-0 items-center justify-between gap-2 border-b", pad, compact ? "h-9" : "h-14")}>
        <div className="flex items-center gap-2">
          {brand ?? <img src="/logo-mark.svg" alt="" width={24} height={24} className={compact ? "size-4" : "size-6"} />}
          <span
            role="img"
            aria-label={ready ? "Agent ready" : "Agent not ready"}
            className={cn("size-2 rounded-full border", ready ? "border-foreground/30 bg-primary" : "bg-muted")}
          />
        </div>
        {headerActions && <div className="flex items-center gap-1">{headerActions}</div>}
      </header>

      <div ref={list} className={cn("flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain", pad, compact ? "py-3" : "py-6")}>
        <div className={cn("mx-auto flex w-full flex-1 flex-col", compact ? "gap-3" : "gap-6", column)}>
          {messages.length === 0 && !thinking && <EmptyState ready={ready} wallet={wallet} onPick={onPick} compact={compact} />}
          {messages.map((m, i) => <MessageView key={i} message={m} compact={compact} />)}
          {thinking && <LiveThought compact={compact} />}
        </div>
      </div>

      <div className={cn("shrink-0", pad, compact ? "pt-2 pb-2" : "pt-3 pb-4")}>
        <div className={cn("mx-auto w-full", column)}>{composer}</div>
      </div>
    </section>
  );
}
