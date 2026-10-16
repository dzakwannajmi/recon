import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type OrbitItem = { src: string; name: string };

/**
 * Logos spread over dotted rings that turn slowly; each logo counter-turns so it stays upright.
 * Pure CSS (see orbit-spin in globals.css), so it renders on the server and stops under reduced motion.
 */
export function OrbitRotation({
  items,
  center,
  orbitCount = 2,
  orbitGap = 7,
  className,
}: {
  items: OrbitItem[];
  center: ReactNode;
  orbitCount?: number;
  orbitGap?: number;
  className?: string;
}) {
  const perOrbit = Math.ceil(items.length / orbitCount);
  return (
    <div aria-hidden className={cn("orbit relative flex items-center justify-center", className)}>
      <div className="relative z-10 flex size-24 items-center justify-center rounded-full border bg-card shadow-xl md:size-28">{center}</div>
      {Array.from({ length: orbitCount }, (_, o) => {
        // Capped by viewport width so the outer ring fits a phone.
        const size = `min(${12 + orbitGap * (o + 1)}rem, ${72 - 20 * (orbitCount - 1 - o)}vw)`;
        const duration = `${40 + o * 20}s`;
        const ring = items.slice(o * perOrbit, o * perOrbit + perOrbit);
        return (
          <div
            key={o}
            className="orbit-ring absolute rounded-full border-2 border-dotted border-muted-foreground/30"
            style={{ width: size, height: size, animationDuration: duration, animationDirection: o % 2 ? "reverse" : "normal" }}
          >
            {ring.map((item, i) => {
              const angle = (i / ring.length) * 2 * Math.PI + o * 0.6;
              return (
                <div
                  key={item.src}
                  className="absolute w-max -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${50 + 50 * Math.cos(angle)}%`, top: `${50 + 50 * Math.sin(angle)}%` }}
                >
                  <div className="orbit-logo rounded-full border bg-card p-1.5 shadow-lg" style={{ animationDuration: duration, animationDirection: o % 2 ? "normal" : "reverse" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.src} alt="" title={item.name} width={48} height={48} loading="lazy" className="size-10 rounded-full object-contain md:size-12" />
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
