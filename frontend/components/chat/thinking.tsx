"use client";

import ThoughtLine from "@/components/effects/ThoughtLine";
import type { Step } from "./types";

const TONE = { color: "#66645f", glyphColor: "#151515", fontSize: 14, shimmer: false } as const;

/** Shown while the request is open. The API does not stream, so there are no steps to show yet: only the clock. */
export function LiveThought() {
  return <ThoughtLine {...TONE} label="Working" working />;
}

/** The same line, settled after the answer: the real tool names from the response, and the real time taken. */
export function DoneThought({ steps, elapsed }: { steps?: Step[]; elapsed?: number }) {
  if (elapsed === undefined) return null;
  return <ThoughtLine {...TONE} doneLabel="Worked for" working={false} elapsed={elapsed} steps={steps?.map((s) => s.tool)} />;
}
