"use client";

import dynamic from "next/dynamic";
import { WebglSlot } from "./webgl-gate";

const GradientASCII = dynamic(() => import("@/components/effects/GradientASCII"), { ssr: false });

/** Static stand-in: a faint chartreuse wash and a hairline grid, no JavaScript. */
const FALLBACK =
  "absolute inset-0 [background:radial-gradient(60%_80%_at_85%_0%,rgba(180,240,60,0.28),transparent_70%),linear-gradient(to_right,#e1ded9_1px,transparent_1px)_0_0/48px_48px]";

/** The hero background: ASCII glyphs in ink and chartreuse on the bone canvas. Lighter on narrow screens. */
export function AsciiBackground({ className }: { className?: string }) {
  return (
    <WebglSlot narrow="light" rootMargin="0px" className={className} fallback={<div className={FALLBACK} />}>
      {(mode) => (
        <GradientASCII
          colors={["#eefbc8", "#d3f58a", "#b4f03c", "#8fc72a"]}
          shape="horizon"
          characters=" .:-=+*#"
          lightMode
          cellSize={mode === "light" ? 22 : 16}
          dpr={mode === "light" ? 1 : 1.5}
          density={0.55}
          glyphOpacity={0.4}
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
