import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { Step } from "./types";

function Json({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <p className="mb-1 text-muted-foreground uppercase">{label}</p>
      <pre className="overflow-x-auto rounded-[6px] bg-secondary p-2 break-all whitespace-pre-wrap">{JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}

/** A tool step as a small chip. Opening it shows the real input and output. */
export function StepCard({ step }: { step: Step }) {
  return (
    <Collapsible className="max-w-full font-mono text-xs">
      <CollapsibleTrigger className="group inline-flex max-w-full items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-foreground">
        <ChevronRight className="size-3 shrink-0 transition-transform group-data-[panel-open]:rotate-90" />
        <span className="min-w-0 truncate text-foreground">{step.tool}</span>
        {step.error && <Badge variant="destructive" className="ml-1 font-mono uppercase">Failed</Badge>}
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 flex flex-col gap-2 rounded-[10px] border bg-card px-3 py-2">
        <Json label="Input" value={step.args} />
        <Json label="Output" value={step.result} />
      </CollapsibleContent>
    </Collapsible>
  );
}
