"use client";

import { useEffect, useReducer, useRef } from "react";
import type { Reply } from "@/components/chat/types";
import { CLOSED, callReducer, wantsMic } from "@/lib/voice/call-state";
import { createRecognizer, recognitionError, speak, type Recognizer } from "@/lib/voice/recognition";
import { markdownToSpeech, splitForSpeech } from "@/lib/voice/speech-text";

/**
 * Runs call mode: the mic, the question to the agent, and the spoken answer, in that order, driven by the
 * state machine in lib/voice/call-state. The mic is open only while the phase is "listening".
 */
export function useCall(open: boolean, ask: (text: string) => Promise<Reply>) {
  const [state, dispatch] = useReducer(callReducer, CLOSED);
  const rec = useRef<Recognizer | null>(null);
  const askRef = useRef(ask);
  askRef.current = ask;
  const round = useRef(0); // bumps on open and close so an answer that arrives after the call ended is dropped

  const stopMic = () => {
    rec.current?.abort();
    rec.current = null;
  };

  useEffect(() => {
    round.current += 1;
    dispatch({ type: open ? "open" : "close" });
    if (!open) stopMic();
  }, [open]);

  // Start the mic when the call wants it (open, nothing being thought or said, no fatal error).
  const wants = wantsMic(state);
  useEffect(() => {
    if (!wants) return undefined;
    const timer = setTimeout(() => {
      const r = createRecognizer(
        { continuous: false, interim: true },
        {
          onInterim: (text) => dispatch({ type: "interim", text }),
          onFinal: (text) => dispatch({ type: "heard", text }),
          onError: (code) => {
            const e = recognitionError(code);
            if (e) dispatch({ type: "fail", message: e.message, fatal: e.fatal });
          },
          onEnd: () => dispatch({ type: "mic_off" }),
        },
      );
      if (!r) {
        dispatch({ type: "fail", message: "This browser cannot listen. Try Chrome or Safari.", fatal: true });
        return;
      }
      rec.current = r;
      dispatch({ type: "mic_on" });
      r.start();
    }, 250);
    return () => clearTimeout(timer);
  }, [wants]);

  // The mic is closed whenever the agent is working or talking, and when the call ends.
  useEffect(() => {
    if (!state.open || state.phase === "thinking" || state.phase === "speaking") stopMic();
  }, [state.open, state.phase]);

  // Ask once per question.
  useEffect(() => {
    if (state.phase !== "thinking") return;
    const mine = round.current;
    askRef.current(state.transcript).then((reply) => {
      if (round.current !== mine) return;
      if (!reply) dispatch({ type: "fail", message: "No answer came back. Try again.", fatal: false });
      else if (reply.error) dispatch({ type: "fail", message: reply.text, fatal: false });
      else dispatch({ type: "answered", text: markdownToSpeech(reply.text) });
    });
  }, [state.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // Say the answer. Leaving this phase (end of call, next event) cancels the speech.
  useEffect(() => {
    if (state.phase !== "speaking") return undefined;
    const s = speak(splitForSpeech(state.reply), () => dispatch({ type: "spoken" }));
    return () => s.cancel();
  }, [state.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(
    () => () => {
      stopMic();
      if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    },
    [],
  );

  return state;
}
