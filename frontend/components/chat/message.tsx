import { CircleAlert } from "lucide-react";
import { Markdown } from "./markdown";
import { StepCard } from "./step-card";
import type { Message } from "./types";

export function MessageView({ message: m }: { message: Message }) {
  if (m.role === "user") {
    return (
      <div className="max-w-[85%] self-end rounded-[16px] bg-primary px-4 py-2.5 text-foreground [overflow-wrap:anywhere] whitespace-pre-wrap">
        {m.text}
      </div>
    );
  }
  return (
    <div className="flex max-w-[92%] min-w-0 flex-col gap-2 self-start">
      {m.steps?.map((s, j) => <StepCard key={j} step={s} />)}
      {m.error ? (
        <div role="alert" className="flex gap-2 rounded-[16px] border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-destructive [overflow-wrap:anywhere]">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          {m.text}
        </div>
      ) : (
        <div className="rounded-[16px] border bg-card px-4 py-3">
          <Markdown text={m.text} />
        </div>
      )}
    </div>
  );
}
