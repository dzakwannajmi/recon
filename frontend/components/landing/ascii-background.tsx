"use client";

import dynamic from "next/dynamic";
import { WebglSlot } from "./webgl-gate";

const GradientASCII = dynamic(() => import("@/components/effects/GradientASCII"), { ssr: false });

/** Static stand-in: faint chartreuse washes at the sides and the bottom, no JavaScript. */
const FALLBACK =
  "absolute inset-0 [background:radial-gradient(40%_60%_at_0%_50%,rgba(180,240,60,0.22),transparent_70%),radial-gradient(40%_60%_at_100%_50%,rgba(180,240,60,0.22),transparent_70%),radial-gradient(70%_30%_at_50%_100%,rgba(180,240,60,0.22),transparent_70%)]";

/** The hero background: ASCII glyphs in ink and chartreuse on the bone canvas. Lighter on narrow screens. */
export function AsciiBackground({ className }: { className?: string }) {
  return (
    <WebglSlot narrow="light" rootMargin="0px" className={className} fallback={<div className={FALLBACK} />}>
      {(mode) => (
        <GradientASCII
          colors={["#eefbc8", "#d3f58a", "#b4f03c", "#8fc72a"]}
          shape="pinch"
          characters=" .:-=+*#"
          lightMode
          cellSize={mode === "light" ? 22 : 16}
          dpr={mode === "light" ? 1 : 1.5}
          density={0.55}
          glyphOpacity={0.55}
          gradientOpacity={0.4}
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
