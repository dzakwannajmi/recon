"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { gateMode, type GateMode } from "./gate-mode";

let webglChecked: boolean | null = null;

/** True if this browser can create a WebGL 2 context. Checked once; the probe context is released at once. */
function hasWebgl2(): boolean {
  if (webglChecked !== null) return webglChecked;
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    webglChecked = !!gl;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    webglChecked = false;
  }
  return webglChecked;
}

const NARROW = "(max-width: 639px)";
const REDUCED = "(prefers-reduced-motion: reduce)";

const whenIdle = (fn: () => void): (() => void) => {
  if (typeof requestIdleCallback === "function") {
    const id = requestIdleCallback(fn, { timeout: 1500 });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(fn, 300);
  return () => clearTimeout(id);
};

type Props = {
  /** What a narrow screen gets: a lighter effect or the static fallback. */
  narrow?: "light" | "static";
  /** Only start the effect once the slot is within this distance of the viewport. */
  rootMargin?: string;
  className?: string;
  /** Always rendered first, and stays when the effect cannot run. Static, no JavaScript needed. */
  fallback: ReactNode;
  /** The effect. Called only in the browser, only for "full" or "light". */
  children: (mode: Exclude<GateMode, "static">) => ReactNode;
};

/**
 * Mounts a WebGL effect only when it is worth it: after the page is idle, once the slot is near the viewport,
 * in a browser with WebGL 2, without reduced motion. The effects pause themselves when offscreen or in a hidden tab.
 * The server and the first client render show only the fallback, so text never waits on WebGL.
 */
export function WebglSlot({ narrow = "static", rootMargin = "200px", className, fallback, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<GateMode>("static");
  const [near, setNear] = useState(false);
  const [idle, setIdle] = useState(false);

  useEffect(() => {
    const reduced = window.matchMedia(REDUCED);
    const narrowQuery = window.matchMedia(NARROW);
    const update = () => setMode(gateMode({ reducedMotion: reduced.matches, webgl: hasWebgl2(), narrow: narrowQuery.matches }, narrow));
    update();
    reduced.addEventListener("change", update);
    narrowQuery.addEventListener("change", update);
    return () => {
      reduced.removeEventListener("change", update);
      narrowQuery.removeEventListener("change", update);
    };
  }, [narrow]);

  useEffect(() => whenIdle(() => setIdle(true)), []);

  useEffect(() => {
    const el = ref.current;
    if (!el || near) return undefined;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return undefined;
    }
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setNear(true), { rootMargin });
    io.observe(el);
    return () => io.disconnect();
  }, [near, rootMargin]);

  return (
    <div ref={ref} className={cn("relative", className)} aria-hidden="true">
      {fallback}
      {mode !== "static" && near && idle && <div className="absolute inset-0">{children(mode)}</div>}
    </div>
  );
}
