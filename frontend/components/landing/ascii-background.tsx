"use client";

import dynamic from "next/dynamic";
import { WebglSlot } from "./webgl-gate";

const GradientASCII = dynamic(() => import("@/components/effects/GradientASCII"), { ssr: false });

/** Static stand-in without JavaScript: plain canvas, no green wash. */
const FALLBACK = "absolute inset-0";

/** The hero background: crisp ink-gray ASCII glyphs on the bone canvas, with no green fill. Lighter on narrow screens. */
export function AsciiBackground({ className }: { className?: string }) {
  return (
    <WebglSlot narrow="light" rootMargin="0px" className={className} fallback={<div className={FALLBACK} />}>
      {(mode) => (
        <GradientASCII
          colors={["#d6d3cd", "#9a978f", "#55534e", "#151515"]}
          shape="pinch"
          characters=" .:-=+*#%@8SX0"
          lightMode
          cellSize={mode === "light" ? 22 : 16}
          dpr={mode === "light" ? 1 : 1.5}
          density={0.9}
          glyphOpacity={0.85}
          gradientOpacity={0}
          glow={0}
          flicker={0.1}
          grain={0}
          speed={0.6}
          intro={false}
          mouseInteraction={mode === "full"}
          clickEffect="none"
        />
      )}
    </WebglSlot>
  );
}
