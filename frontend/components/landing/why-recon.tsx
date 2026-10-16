import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Container, SectionHeading } from "./container";

const LEFT = ["Only one number or one word.", "No source shown.", "No date."];

const FLAG_FORM = "Mismatch between {document} ({page}) and on-chain {value} as of {date}.";

/** Side-by-side comparison of two forms of output. Describes form only; no other product is named. */
export function WhyRecon() {
  return (
    <section id="why-recon" aria-labelledby="why-title" className="scroll-mt-16 py-16 md:py-24">
      <Container className="flex flex-col items-center">
        <SectionHeading id="why-title" lead="Facts you can" tail="check again" />
        <p className="mt-4 max-w-[720px] text-center text-lg text-balance leading-[1.3] text-muted-foreground">
          Recon shows facts and flags with their sources. It does not give grades or scores.
        </p>

        <div className="mt-10 grid w-full gap-4 md:mt-14 md:grid-cols-2 md:gap-6">
          <section aria-labelledby="why-left" className="flex flex-col gap-5 rounded-[16px] border border-dashed bg-accent/50 p-5 md:p-8">
            <h3 id="why-left" className="text-xl leading-[1.3] text-muted-foreground">A bare score or summary</h3>
            <ul className="flex flex-col gap-4">
              {LEFT.map((line) => (
                <li key={line} className="flex items-start gap-3 text-muted-foreground">
                  <Mark tone="muted"><X className="size-3.5" strokeWidth={1.5} /></Mark>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="why-right" className="flex flex-col gap-5 rounded-[16px] border bg-card p-5 md:p-8">
            <h3 id="why-right" className="text-xl leading-[1.3]">A Recon fact sheet</h3>
            <ul className="flex flex-col gap-4">
              <li className="flex items-start gap-3">
                <Mark tone="accent"><Check className="size-3.5" strokeWidth={1.5} /></Mark>
                <div className="flex min-w-0 flex-col gap-2">
                  <span>A dated flag:</span>
                  <code className="rounded-[10px] border bg-background px-3 py-2 font-mono text-sm leading-[1.5] break-words">{FLAG_FORM}</code>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <Mark tone="accent"><Check className="size-3.5" strokeWidth={1.5} /></Mark>
                <span>The exact quote, its location, the source link, and the snapshot hash.</span>
              </li>
              <li className="flex items-start gap-3">
                <Mark tone="accent"><Check className="size-3.5" strokeWidth={1.5} /></Mark>
                <span>Flags computed by code from recorded data, not set by an AI.</span>
              </li>
            </ul>
          </section>
        </div>

        <p className="mt-8 text-center text-lg leading-[1.3] md:mt-10">Each flag shows the evidence behind it.</p>
      </Container>
    </section>
  );
}

/** Small decorative tile at the start of a line. Chartreuse is fill only. */
function Mark({ tone, children }: { tone: "muted" | "accent"; children: React.ReactNode }) {
  return (
    <span
      aria-hidden
      className={cn(
        "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-[8px]",
        tone === "accent" ? "bg-primary text-primary-foreground" : "border bg-card text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}
