"use client";

import ThoughtLine from "@/components/effects/ThoughtLine";
import type { Step } from "./types";

const TONE = { color: "#66645f", glyphColor: "#151515", shimmer: false } as const;
const size = (compact?: boolean) => (compact ? 12 : 14);

/** Shown while the request is open. The API does not stream, so there are no steps to show yet: only the clock. */
export function LiveThought({ compact }: { compact?: boolean }) {
  return <ThoughtLine {...TONE} fontSize={size(compact)} label="Working" working />;
}

/** The same line, settled after the answer: the real tool names from the response, and the real time taken. */
export function DoneThought({ steps, elapsed, compact }: { steps?: Step[]; elapsed?: number; compact?: boolean }) {
  if (elapsed === undefined) return null;
  return <ThoughtLine {...TONE} fontSize={size(compact)} doneLabel="Worked for" working={false} elapsed={elapsed} steps={steps?.map((s) => s.tool)} />;
}
