"use client";

import dynamic from "next/dynamic";
import { WebglSlot } from "@/components/landing/webgl-gate";
import type { CallPhase } from "@/lib/voice/call-state";
import { cn } from "@/lib/utils";

const Strands = dynamic(() => import("@/components/effects/Strands"), { ssr: false });

/** How lively the strands are in each phase. */
const ENERGY: Record<CallPhase, number> = { idle: 0.12, listening: 0.3, thinking: 0.7, speaking: 0.95 };

/** The static orb: used with reduced motion, without WebGL, and until the effect has started. */
function StaticOrb({ phase }: { phase: CallPhase }) {
  return (
    <div
      data-phase={phase}
      className={cn(
        "absolute inset-[14%] rounded-full border border-input [background:radial-gradient(circle_at_35%_30%,#e6fbb0,#b4f03c_55%,#8fc72a)]",
        phase === "idle" && "opacity-60",
        phase === "listening" && "ring-4 ring-foreground/15",
        phase === "thinking" && "ring-4 ring-primary",
        phase === "speaking" && "ring-8 ring-foreground/20",
      )}
    />
  );
}

/** The call orb. Strands drives it from the phase; no audio level is read, only the phase. */
export function Orb({ phase, className }: { phase: CallPhase; className?: string }) {
  return (
    <WebglSlot narrow="light" rootMargin="0px" className={cn("size-[min(70vw,360px)]", className)} fallback={<StaticOrb phase={phase} />}>
      {(mode) => (
        <Strands
          colors={["#151515", "#8fc72a", "#b4f03c"]}
          lightMode
          glass={false}
          listening={phase === "listening"}
          energy={ENERGY[phase]}
          interactive={mode === "full"}
          intro={false}
          maxDevicePixelRatio={mode === "light" ? 1 : 1.5}
        />
      )}
    </WebglSlot>
  );
}
