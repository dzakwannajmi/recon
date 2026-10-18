import { CircleCheck } from "lucide-react";

/** Marks evidence that has been paid for: a green check and the word, so it does not rely on colour alone. */
export function PaidBadge({ label = "Paid" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
      <CircleCheck className="size-3.5" aria-hidden="true" />
      {label}
    </span>
  );
}
