"use client";

import dynamic from "next/dynamic";
import { WebglSlot } from "./webgl-gate";

const CrystalizedBall = dynamic(() => import("@/components/effects/CrystalizedBall"), { ssr: false });

const FALLBACK =
  "absolute inset-[12%] rounded-full border border-input [background:radial-gradient(circle_at_35%_30%,#e6fbb0,#b4f03c_55%,#8fc72a)]";

/** The accent ball in the palette: chartreuse on the light theme. Static circle on narrow screens, with reduced motion, and without WebGL. */
export function Ball({ className }: { className?: string }) {
  return (
    <WebglSlot narrow="static" className={className} fallback={<div className={FALLBACK} />}>
      {() => <CrystalizedBall preset="solar" theme="light" color="#8fc72a" size={0.8} interactive={false} intro={false} />}
    </WebglSlot>
  );
}
