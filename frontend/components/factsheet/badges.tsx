import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** The feed value itself (OK, WARNING, CRITICAL), or the "unpublished" text when status is null. Words only, no scale. */
export function StatusBadge({ status, unpublished, className }: { status: "OK" | "WARNING" | "CRITICAL" | null; unpublished: string; className?: string }) {
  if (status === null) return <Badge variant="outline" className={className}>{unpublished}</Badge>;
  if (status === "CRITICAL") return <Badge variant="destructive" className={className}>{status}</Badge>;
  if (status === "WARNING") return <Badge variant="outline" className={cn("border-amber-700/40 bg-amber-500/15 text-amber-900", className)}>{status}</Badge>;
  return <Badge variant="outline" className={cn("border-emerald-700/40 bg-emerald-500/15 text-emerald-900", className)}>{status}</Badge>;
}
