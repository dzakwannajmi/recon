"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** The screen is laid out once at this size, then scaled to fit, so the picture is the same shape at every width. */
const STAGE_W = 1280;
const STAGE_H = 800;
const MENU_H = 32;
const NOTCH_W = 188;

const MENU = ["Chat", "File", "Edit", "View", "Window", "Help"];

/**
 * A 14-inch laptop drawn in CSS: dark aluminium lid, thin bezel, rounded screen, camera notch,
 * a plain menu bar, hinge and a base with a thumb notch. No images.
 * Sizes use container units of the lid width, so the whole body scales with it; the screen content is a
 * fixed 1280 x 800 stage scaled by the measured screen width. The only shadow is the soft contact shadow under the base.
 */
export function Laptop({ children }: { children: ReactNode }) {
  const screen = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState<number | null>(null);

  useEffect(() => {
    const el = screen.current;
    if (!el) return undefined;
    const measure = () => setScale(el.clientWidth / STAGE_W);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="mx-auto w-full max-w-[1200px] [container-type:inline-size]">
      {/* Lid: aluminium edge, black display bezel. */}
      <div className="rounded-t-[2.2cqw] rounded-b-[0.3cqw] border border-[#55555a] bg-gradient-to-b from-[#3a3a3e] to-[#2a2a2d] p-[0.18cqw]">
        <div className="rounded-t-[2cqw] rounded-b-[0.2cqw] bg-black px-[1.05cqw] pt-[1.05cqw] pb-[1.3cqw]">
          <div ref={screen} className="relative aspect-[16/10] overflow-hidden rounded-[0.9cqw] bg-background">
            <div
              className="absolute top-0 left-0 origin-top-left bg-background"
              style={{ width: STAGE_W, height: STAGE_H, transform: `scale(${scale ?? 1})`, visibility: scale === null ? "hidden" : "visible" }}
            >
              <div aria-hidden className="relative flex items-center border-b bg-[#ebe8e4] px-5 text-[13px] text-foreground" style={{ height: MENU_H }}>
                <ul className="flex gap-5">
                  {MENU.map((m) => <li key={m}>{m}</li>)}
                </ul>
                {/* The camera notch cuts into the top of the screen. */}
                <span
                  className="absolute top-0 left-1/2 -translate-x-1/2 rounded-b-[14px] bg-black"
                  style={{ width: NOTCH_W, height: MENU_H - 2 }}
                >
                  <i className="absolute top-1/2 left-1/2 size-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#15161a] ring-1 ring-[#26272c]" />
                </span>
              </div>
              <div style={{ height: STAGE_H - MENU_H }}>{children}</div>
            </div>
          </div>
        </div>
      </div>
      {/* Hinge and base with the thumb notch. */}
      <div aria-hidden>
        <div className="relative -mx-[1.2cqw] h-[1.5cqw] rounded-b-[1.4cqw] rounded-t-[0.2cqw] border border-t-0 border-[#55555a] bg-gradient-to-b from-[#4a4a4f] via-[#303033] to-[#222225]">
          <span className="absolute top-0 left-1/2 h-[0.6cqw] w-[14cqw] -translate-x-1/2 rounded-b-[1cqw] bg-[#17171a]" />
        </div>
        <div className="mx-auto -mt-[0.4cqw] h-[2cqw] w-[88%] rounded-full bg-black/20 blur-xl" />
      </div>
    </div>
  );
}
