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

export function StepCard({ step }: { step: Step }) {
  return (
    <Collapsible className="rounded-[10px] border bg-card font-mono text-xs">
      <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-[10px] px-3 py-2 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-foreground">
        <ChevronRight className="size-3.5 transition-transform group-data-[panel-open]:rotate-90" />
        <span className="text-muted-foreground uppercase">Tool</span>
        <span className="min-w-0 truncate text-foreground">{step.tool}</span>
        {step.error && <Badge variant="destructive" className="ml-auto font-mono uppercase">Failed</Badge>}
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-2 border-t px-3 py-2">
        <Json label="Input" value={step.args} />
        <Json label="Output" value={step.result} />
      </CollapsibleContent>
    </Collapsible>
  );
}
