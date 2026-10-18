import { CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { offersOf } from "@/lib/browser-payer/offer";
import { EvidenceCard } from "./evidence-card";
import { Markdown } from "./markdown";
import { MessageActions } from "./message-actions";
import { StepCard } from "./step-card";
import { DoneThought } from "./thinking";
import type { Message } from "./types";

/** `actions`: show the copy, rating and try-again row under an answer; `onRegenerate` only on the last model answer. */
export function MessageView({ message: m, compact, actions, onRegenerate }: { message: Message; compact?: boolean; actions?: boolean; onRegenerate?: () => void }) {
  if (m.role === "user") {
    return (
      <div className={cn("max-w-[85%] self-end rounded-[16px] bg-primary text-foreground [overflow-wrap:anywhere] whitespace-pre-wrap", compact ? "px-3 py-1.5" : "px-4 py-2.5")}>
        {m.text}
      </div>
    );
  }
  return (
    <div className="flex max-w-full min-w-0 flex-col items-start gap-2 self-start">
      <DoneThought steps={m.steps} elapsed={m.elapsed} compact={compact} />
      {m.steps && m.steps.length > 0 && (
        <div className="flex max-w-full flex-wrap items-start gap-1.5">
          {m.steps.map((s, j) => <StepCard key={j} step={s} />)}
        </div>
      )}
      {offersOf(m.steps).map((o) => <EvidenceCard key={`${o.assetCode}:${o.issuer ?? ""}`} offer={o} autoPayId={m.autoPayId} />)}
      {m.error ? (
        <div role="alert" className={cn("flex gap-2 rounded-[16px] border border-destructive/30 bg-destructive/10 text-destructive [overflow-wrap:anywhere]", compact ? "px-3 py-1.5" : "px-4 py-2.5")}>
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          {m.text}
        </div>
      ) : (
        <Markdown text={m.text} className="leading-relaxed" />
      )}
      {actions && !m.error && m.text.trim() !== "" && <MessageActions text={m.text} onRegenerate={onRegenerate} />}
    </div>
  );
}
