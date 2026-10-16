"use client";

import dynamic from "next/dynamic";
import type { CSSProperties } from "react";
import { WebglSlot } from "./webgl-gate";

const DitherVeil = dynamic(() => import("@/components/effects/DitherVeil"), { ssr: false });

/** Local images only; the effect's own default is a remote URL and is never used. */
export const MASCOT_SRC = "/mascot.png";
/** The same cut-out flattened on the page canvas, because the effect needs an opaque image. */
export const MASCOT_DITHER_SRC = "/mascot-dither.png";

/** The dithered band: a horizontal strip across the head and shoulders, feathered at the sides. */
const BAND: CSSProperties = {
  maskImage:
    "linear-gradient(to bottom, transparent 21%, #000 21%, #000 50%, transparent 50%), linear-gradient(to right, transparent, #000 16%, #000 84%, transparent)",
  WebkitMaskImage:
    "linear-gradient(to bottom, transparent 21%, #000 21%, #000 50%, transparent 50%), linear-gradient(to right, transparent, #000 16%, #000 84%, transparent)",
  maskComposite: "intersect",
  WebkitMaskComposite: "source-in",
};

/**
 * The mascot, as tall as its parent. The plain cut-out is always there (and is the whole fallback);
 * across a band the effect shows it as a 1-bit dither that turns to full colour under the pointer.
 */
export function Mascot({ className }: { className?: string }) {
  return (
    <div aria-hidden className={className}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={MASCOT_SRC} alt="" width={780} height={1203} className="absolute left-1/2 top-0 h-full w-auto max-w-none -translate-x-1/2" />
      <div className="absolute inset-0" style={BAND}>
        <WebglSlot narrow="light" className="absolute inset-0" fallback={null}>
          {(mode) => (
            <DitherVeil
              src={MASCOT_DITHER_SRC}
              fit="contain"
              pattern="bayer"
              pixelSize={mode === "light" ? 2 : 3}
              inkColor="#151515"
              paperColor="#f4f2f0"
              brightness={-0.04}
              revealRadius={mode === "light" ? 110 : 170}
              wander
              clickBurst={false}
            />
          )}
        </WebglSlot>
      </div>
    </div>
  );
}
