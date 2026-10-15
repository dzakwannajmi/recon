"use client";

import dynamic from "next/dynamic";
import { WebglSlot } from "./webgl-gate";

const DitherVeil = dynamic(() => import("@/components/effects/DitherVeil"), { ssr: false });

/** A local image only; the effect's own default is a remote URL and is never used. */
export const DITHER_SRC = "/dither-mark.png";

/** The logo mark as a dithered image that reveals under the pointer. Static image on narrow screens and as the fallback. */
export function DitherImage({ className }: { className?: string }) {
  return (
    <WebglSlot
      narrow="static"
      className={className}
      fallback={
        // eslint-disable-next-line @next/next/no-img-element
        <img src={DITHER_SRC} alt="" width={600} height={600} className="absolute inset-0 size-full object-cover" />
      }
    >
      {() => (
        <DitherVeil
          src={DITHER_SRC}
          fit="cover"
          pattern="bayer"
          pixelSize={3}
          inkColor="#151515"
          paperColor="#f4f2f0"
          revealRadius={160}
          wander
          clickBurst={false}
        />
      )}
    </WebglSlot>
  );
}
