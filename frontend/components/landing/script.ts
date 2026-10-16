import type { Demo } from "./demo";

/** The sample conversation, built from the sample asset's data. Plain text paragraphs: no markdown, so a half-typed answer never shows stray symbols. */
export type Script = { prompt: string; paragraphs: string[]; thinkMs: number };

export const TIMING = { promptAtMs: 600, thinkMs: 2000, charsPerSecond: 70 } as const;

export function buildScript(d: Demo): Script {
  return {
    prompt: `Check ${d.code}`,
    thinkMs: TIMING.thinkMs,
    paragraphs: [
      `${d.code} (${d.issuerOrg}) has status ${d.status} as of ${d.asOf}.`,
      `Flag: ${d.flagName}.`,
      d.statement,
      `Quote from the document: ${d.quote}`,
    ],
  };
}

export type Frame = {
  /** The user's message is on screen. */
  promptShown: boolean;
  /** The agent is working; the answer has not started. */
  thinking: boolean;
  /** How many characters of the joined answer are visible. */
  typed: number;
  done: boolean;
};

export const totalChars = (s: Script) => s.paragraphs.reduce((n, p) => n + p.length, 0);

/** What is on screen `t` milliseconds after the animation starts. Pure, so the timeline can be tested without a browser. */
export function frameAt(t: number, s: Script): Frame {
  const answerAt = TIMING.promptAtMs + s.thinkMs;
  const total = totalChars(s);
  const typed = Math.max(0, Math.min(total, Math.floor(((t - answerAt) * TIMING.charsPerSecond) / 1000)));
  return { promptShown: t >= TIMING.promptAtMs, thinking: t >= TIMING.promptAtMs && t < answerAt, typed, done: typed >= total };
}

/** The time at which the last character is shown. */
export const endMs = (s: Script) => TIMING.promptAtMs + s.thinkMs + Math.ceil((totalChars(s) * 1000) / TIMING.charsPerSecond);

/** The paragraphs cut to `n` characters in total. Empty paragraphs are dropped. */
export function visibleParagraphs(paragraphs: readonly string[], n: number): string[] {
  const out: string[] = [];
  let left = n;
  for (const p of paragraphs) {
    if (left <= 0) break;
    out.push(p.slice(0, left));
    left -= p.length;
  }
  return out;
}
