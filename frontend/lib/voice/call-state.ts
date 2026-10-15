/**
 * Call mode as a small state machine. Pure: the browser parts (mic, speech) live in components/call and only
 * send events here. An event that does not fit the current phase is ignored, so a late answer after the call
 * was closed cannot bring it back.
 */
import { stripWakePhrase } from "./wake";

export type CallPhase = "idle" | "listening" | "thinking" | "speaking";

export type CallState = {
  open: boolean;
  phase: CallPhase;
  /** What the user said (live while listening, final once sent). */
  transcript: string;
  /** What the agent answered, as plain text. */
  reply: string;
  /** A plain-words message. While `fatal` is true the call cannot go on and the mic stays closed. */
  error: string | null;
  fatal: boolean;
};

export type CallEvent =
  | { type: "open" }
  | { type: "close" }
  | { type: "mic_on" }
  | { type: "mic_off" }
  | { type: "interim"; text: string }
  | { type: "heard"; text: string }
  | { type: "answered"; text: string }
  | { type: "spoken" }
  | { type: "fail"; message: string; fatal: boolean };

export const CLOSED: CallState = { open: false, phase: "idle", transcript: "", reply: "", error: null, fatal: false };

export function callReducer(s: CallState, e: CallEvent): CallState {
  if (e.type === "open") return { ...CLOSED, open: true };
  if (e.type === "close") return CLOSED;
  if (!s.open) return s;
  switch (e.type) {
    case "mic_on":
      return s.phase === "idle" && !s.fatal ? { ...s, phase: "listening" } : s;
    case "mic_off":
      return s.phase === "listening" ? { ...s, phase: "idle" } : s;
    case "interim":
      return s.phase === "listening" ? { ...s, transcript: stripWakePhrase(e.text) } : s;
    case "heard": {
      if (s.phase !== "listening") return s;
      const text = stripWakePhrase(e.text);
      // Only the wake words, or silence: keep listening.
      return text ? { ...s, phase: "thinking", transcript: text, error: null } : { ...s, transcript: "" };
    }
    case "answered":
      return s.phase === "thinking" ? { ...s, phase: "speaking", reply: e.text } : s;
    case "spoken":
      return s.phase === "speaking" ? { ...s, phase: "idle" } : s;
    case "fail":
      return { ...s, phase: "idle", error: e.message, fatal: e.fatal };
  }
}

/** True when the mic should be open: the call is open, nothing is being thought or said, and no fatal error. */
export const wantsMic = (s: CallState) => s.open && s.phase === "idle" && !s.fatal;

/** Hiding the tab ends the call: nothing may keep listening or talking in the background. */
export const closesOnHide = (s: CallState, hidden: boolean) => hidden && s.open;
