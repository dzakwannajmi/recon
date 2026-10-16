"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChatView } from "@/components/chat/chat-view";
import type { Message } from "@/components/chat/types";
import { DemoComposer } from "./demo-composer";
import { endMs, frameAt, visibleParagraphs, type Script } from "./script";

/** Redraw at most this often, in ms: a gentle typing pace, and the chat list is not rescrolled every frame. */
const STEP_MS = 40;

/** The messages on screen for one frame of the script. */
function messagesAt(script: Script, t: number): Message[] {
  const f = frameAt(t, script);
  if (!f.promptShown) return [];
  const out: Message[] = [{ role: "user", text: script.prompt }];
  if (!f.thinking) out.push({ role: "agent", text: visibleParagraphs(script.paragraphs, f.typed).join("\n\n") });
  return out;
}

/**
 * A scripted conversation inside the real chat view. It makes no network or model call: it only replays text built at build time.
 * It starts when scrolled into view, pauses offscreen and in a hidden tab, and with reduced motion shows the final state.
 */
export function ChatDemo({ script }: { script: Script }) {
  const root = useRef<HTMLDivElement>(null);
  const total = useMemo(() => endMs(script), [script]);
  // The server render and the first paint show the finished conversation; the animation replaces it once the screen is in view.
  const [t, setT] = useState(total);

  useEffect(() => {
    const el = root.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches || typeof IntersectionObserver === "undefined") return undefined;
    let clock = 0;
    let last = 0;
    let raf = 0;
    let started = false;
    let visible = false;
    let finished = false;
    let shown = -1;

    const tick = (now: number) => {
      clock += last ? Math.min(now - last, 100) : 0;
      last = now;
      raf = 0;
      const step = Math.floor(clock / STEP_MS);
      if (step !== shown) {
        shown = step;
        setT(Math.min(clock, total));
      }
      if (clock >= total) {
        finished = true;
        setT(total);
      } else {
        raf = requestAnimationFrame(tick);
      }
    };
    const sync = () => {
      const run = visible && !document.hidden && !finished;
      if (run && !raf) {
        last = 0;
        raf = requestAnimationFrame(tick);
      } else if (!run && raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };
    const io = new IntersectionObserver((entries) => {
      visible = entries.some((e) => e.isIntersecting);
      if (visible && !started) {
        started = true;
        setT(0);
      }
      sync();
    }, { threshold: 0.35 });
    io.observe(el);
    document.addEventListener("visibilitychange", sync);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", sync);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [total]);

  const messages = messagesAt(script, t);
  const thinking = frameAt(t, script).thinking;
  return (
    <div ref={root} className="h-full">
      <ChatView
        compact
        ready
        messages={messages}
        thinking={thinking}
        onPick={() => {}}
        composer={<DemoComposer />}
        headerActions={<span className="rounded-full border px-3 py-0.5 text-[13px] text-muted-foreground">Sample</span>}
        className="text-[18px] leading-[1.5]"
        column="w-[70%] gap-6"
      />
    </div>
  );
}
