import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { AssetStatus, ReviewedFlag } from "@/lib/flags/status";
import type { FactSheetCopy } from "@/lib/factsheet/copy-types";
import { cn } from "@/lib/utils";
import { fmt } from "@/lib/factsheet/view";
import { EvidenceList } from "./evidence";

function FlagTitle({ copy, flag }: { copy: FactSheetCopy; flag: ReviewedFlag["flag"] }) {
  // An unknown flag id can't happen after validation; fall back to the id anyway.
  const name = copy.flags[flag]?.name ?? flag;
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
      <h3 className="font-medium">{name}</h3>
      <code className="font-mono text-xs text-muted-foreground break-all">{flag}</code>
    </div>
  );
}

function SeverityBadge({ severity }: { severity: "WARNING" | "CRITICAL" }) {
  return severity === "CRITICAL"
    ? <Badge variant="destructive">{severity}</Badge>
    : <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-300">{severity}</Badge>;
}

const Section = ({ title, intro, children }: { title: string; intro?: string; children: React.ReactNode }) => (
  <section className="flex flex-col gap-3">
    <div>
      <h2 className="text-xl font-semibold">{title}</h2>
      {intro && <p className="mt-1 text-sm text-muted-foreground">{intro}</p>}
    </div>
    {children}
  </section>
);

export function RaisedSection({ copy, asset }: { copy: FactSheetCopy; asset: AssetStatus }) {
  return (
    <Section title={copy.sections.raisedTitle} intro={copy.sections.raisedIntro}>
      {asset.raised.length === 0 ? (
        <p className="text-sm text-muted-foreground">{copy.sections.raisedEmpty}</p>
      ) : (
        asset.raised.map((f) => (
          <Card key={f.flag}>
            <CardHeader className="gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <FlagTitle copy={copy} flag={f.flag} />
                <SeverityBadge severity={f.effective_severity} />
              </div>
              {f.review !== "not_needed" && (
                <p className="text-xs text-muted-foreground">{copy.review[f.review]}</p>
              )}
            </CardHeader>
            <CardContent className="min-w-0 text-sm">
              <p lang="en" className="break-words whitespace-pre-wrap">{f.statement}</p>
              <p className="mt-2 text-xs text-muted-foreground">{fmt(copy.sections.asOf, { date: f.as_of })}</p>
              <EvidenceList copy={copy} evidence={f.evidence} />
            </CardContent>
          </Card>
        ))
      )}
    </Section>
  );
}

export function ClearSection({ copy, asset }: { copy: FactSheetCopy; asset: AssetStatus }) {
  if (asset.clear.length === 0) return null;
  return (
    <Section title={copy.sections.clearTitle} intro={copy.sections.clearIntro}>
      {asset.clear.map((f) => (
        <Card key={f.flag}>
          <CardHeader><FlagTitle copy={copy} flag={f.flag} /></CardHeader>
          <CardContent className="min-w-0 text-sm">
            <p lang="en" className="break-words whitespace-pre-wrap">{f.reason}</p>
            <p className="mt-2 text-xs text-muted-foreground">{fmt(copy.sections.asOf, { date: f.as_of })}</p>
            <EvidenceList copy={copy} evidence={f.evidence} />
          </CardContent>
        </Card>
      ))}
    </Section>
  );
}

export function NotEvaluatedSection({ copy, asset }: { copy: FactSheetCopy; asset: AssetStatus }) {
  if (asset.not_evaluated.length === 0) return null;
  return (
    <Section title={copy.sections.notEvaluatedTitle} intro={copy.sections.notEvaluatedIntro}>
      {asset.not_evaluated.map((f) => (
        <Card key={f.flag} className={cn("border-dashed")}>
          <CardHeader className="gap-1">
            <FlagTitle copy={copy} flag={f.flag} />
            <p className="text-sm text-muted-foreground">{copy.flags[f.flag]?.checks}</p>
          </CardHeader>
          <CardContent className="text-sm"><p lang="en" className="break-words whitespace-pre-wrap">{f.reason}</p></CardContent>
        </Card>
      ))}
    </Section>
  );
}
