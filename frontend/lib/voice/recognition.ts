/**
 * Thin wrapper over the browser's SpeechRecognition (Chrome and Safari expose it as webkitSpeechRecognition).
 * The audio goes to the browser's own speech service; nothing here sends audio to our server.
 * Browser-only: call from effects or event handlers, never during render on the server.
 */

type Alternative = { transcript: string };
type Result = { isFinal: boolean; length: number; [i: number]: Alternative };
type ResultEvent = { resultIndex: number; results: { length: number; [i: number]: Result } };
type ErrorEvent_ = { error: string };

interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: ResultEvent) => void) | null;
  onerror: ((e: ErrorEvent_) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type Ctor = new () => Recognition;

function ctor(): Ctor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const isRecognitionSupported = () => ctor() !== null;
export const isSynthesisSupported = () => typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;

/** Plain-words message for a SpeechRecognition error code. `fatal` means retrying would not help. */
export function recognitionError(code: string): { message: string; fatal: boolean } | null {
  switch (code) {
    // Silence or a stop on purpose: not an error.
    case "no-speech":
    case "aborted":
      return null;
    case "not-allowed":
    case "service-not-allowed":
      return { message: "The microphone is blocked. Allow it in your browser settings to use voice.", fatal: true };
    case "audio-capture":
      return { message: "No microphone was found.", fatal: true };
    case "network":
      return { message: "The browser's speech service could not be reached.", fatal: true };
    case "language-not-supported":
      return { message: "This browser cannot recognise speech in this language.", fatal: true };
    default:
      return { message: "Voice input stopped working. Try again in a moment.", fatal: false };
  }
}

export type Recognizer = { start: () => void; stop: () => void; abort: () => void };

type Handlers = {
  /** Live text of the phrase in progress (only when `interim` is true). */
  onInterim?: (text: string) => void;
  /** A finished phrase. */
  onFinal: (text: string) => void;
  /** A code from `recognitionError`'s input; silence and aborts are not reported. */
  onError: (code: string) => void;
  /** The session ended (after a result, silence, an error, or stop/abort). Always called once per start. */
  onEnd: () => void;
};

export function createRecognizer(opts: { continuous: boolean; interim: boolean; lang?: string }, h: Handlers): Recognizer | null {
  const C = ctor();
  if (!C) return null;
  const r = new C();
  r.lang = opts.lang ?? (typeof navigator !== "undefined" && navigator.language ? navigator.language : "en-US");
  r.continuous = opts.continuous;
  r.interimResults = opts.interim;
  r.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      const text = res[0]?.transcript ?? "";
      if (res.isFinal) {
        if (text.trim()) h.onFinal(text.trim());
      } else interim += text;
    }
    if (interim && opts.interim) h.onInterim?.(interim.trim());
  };
  r.onerror = (e) => h.onError(e.error);
  r.onend = () => h.onEnd();
  return {
    start: () => {
      try {
        r.start();
      } catch {
        // start() throws if a session is already running; that one will report its own end.
      }
    },
    stop: () => r.stop(),
    abort: () => r.abort(),
  };
}

/** Speaks text in pieces, one after the other. `cancel` stops at once and does not call onEnd. */
export function speak(chunks: string[], onEnd: () => void): { cancel: () => void } {
  const synth = window.speechSynthesis;
  let live = true;
  let i = 0;
  const next = () => {
    if (!live) return;
    if (i >= chunks.length) return onEnd();
    const u = new SpeechSynthesisUtterance(chunks[i++]);
    u.onend = next;
    u.onerror = next;
    synth.speak(u);
  };
  synth.cancel();
  next();
  return {
    cancel: () => {
      live = false;
      synth.cancel();
    },
  };
}
