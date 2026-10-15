"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { appendToTextarea } from "@/lib/voice/insert";
import { createRecognizer, isRecognitionSupported, isSynthesisSupported, recognitionError, type Recognizer } from "@/lib/voice/recognition";

/** What this browser can do. False on the server and on the first render, so the markup matches. */
export function useVoiceSupport() {
  const [s, setS] = useState({ dictation: false, call: false });
  useEffect(() => {
    const rec = isRecognitionSupported();
    setS({ dictation: rec, call: rec && isSynthesisSupported() });
  }, []);
  return s;
}

/**
 * Dictation for the prompt bar: the mic is open only between the pill's start and stop.
 * Finished phrases are appended to the prompt's text box; the user still presses send.
 */
export function useDictation(root: React.RefObject<HTMLElement | null>) {
  const rec = useRef<Recognizer | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Changing the key gives the pill a fresh state when the browser ended the session by itself.
  const [pillKey, setPillKey] = useState(0);

  const stop = useCallback(() => {
    rec.current?.abort();
    rec.current = null;
  }, []);
  useEffect(() => stop, [stop]);

  // Hiding the tab closes the mic and resets the pill.
  useEffect(() => {
    const onVis = () => {
      if (!document.hidden || !rec.current) return;
      stop();
      setPillKey((k) => k + 1);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [stop]);

  const start = useCallback(() => {
    setError(null);
    stop();
    const r = createRecognizer(
      { continuous: true, interim: false },
      {
        onFinal: (text) => {
          const el = root.current?.querySelector("textarea");
          if (el) appendToTextarea(el, text);
        },
        onError: (code) => {
          const e = recognitionError(code);
          if (e) setError(e.message);
        },
        onEnd: () => {
          if (rec.current === r) {
            rec.current = null;
            setPillKey((k) => k + 1);
          }
        },
      },
    );
    rec.current = r;
    r?.start();
  }, [root, stop]);

  /** The pill was tapped off: let the last phrase finish, then close the mic. */
  const finish = useCallback(() => {
    const r = rec.current;
    rec.current = null;
    r?.stop();
  }, []);

  return { start, finish, stop, error, pillKey };
}
