"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { appendToTextarea } from "@/lib/voice/insert";
import { createRecognizer, isRecognitionSupported, recognitionError, type Recognizer } from "@/lib/voice/recognition";

/** What this browser can do. False on the server and on the first render, so the markup matches. */
export function useVoiceSupport() {
  const [dictation, setDictation] = useState(false);
  useEffect(() => setDictation(isRecognitionSupported()), []);
  return { dictation };
}

/**
 * Dictation for the prompt bar's mic button. The mic is open only between `dictate` and the end of the session.
 * Finished phrases are appended to the prompt's text box (the user still presses send). The promise `dictate`
 * returns settles when the session ends, so the bar can reset its listening state; it never carries text.
 */
export function useDictation(root: React.RefObject<HTMLElement | null>) {
  const rec = useRef<Recognizer | null>(null);
  const release = useRef<(() => void) | null>(null);
  const [error, setError] = useState<string | null>(null);

  const settle = useCallback(() => {
    const r = release.current;
    release.current = null;
    r?.();
  }, []);

  /** Closes the mic now and drops what is pending. */
  const stop = useCallback(() => {
    rec.current?.abort();
    rec.current = null;
    settle();
  }, [settle]);
  useEffect(() => stop, [stop]);

  // Hiding the tab closes the mic and resets the bar.
  useEffect(() => {
    const onVis = () => {
      if (document.hidden && rec.current) stop();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [stop]);

  const dictate = useCallback(
    () =>
      new Promise<void>((resolve) => {
        setError(null);
        stop();
        release.current = resolve;
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
              if (rec.current === r) rec.current = null;
              settle();
            },
          },
        );
        if (!r) {
          settle();
          return;
        }
        rec.current = r;
        r.start();
      }),
    [root, stop, settle],
  );

  /** The user tapped the mic off: let the last phrase finish, then close the mic. */
  const finish = useCallback(() => {
    const r = rec.current;
    rec.current = null;
    r?.stop();
    settle();
  }, [settle]);

  return { dictate, finish, stop, error };
}
