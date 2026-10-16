import type { ReactNode } from "react";

/**
 * A laptop drawn in CSS: thin dark bezel, camera dot, rounded screen, hinge and base.
 * The only shadow in the page is the soft contact shadow under the base.
 * The screen is a tall card on narrow viewports so the chat stays readable.
 */
export function Laptop({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[920px]">
      <div className="relative rounded-t-[20px] rounded-b-[4px] bg-[#1a1919] px-2.5 pt-3.5 pb-2.5 sm:px-3 sm:pt-5 sm:pb-3">
        <span aria-hidden className="absolute top-1.5 left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-[#3b3a39] sm:top-2" />
        <div className="aspect-[4/5] overflow-hidden rounded-[8px] bg-background sm:aspect-[16/10]">{children}</div>
      </div>
      <div aria-hidden>
        <div className="mx-auto h-[3px] w-full bg-[#8d8a85]" />
        <div className="relative -mx-[4%] h-3.5 rounded-b-[16px] rounded-t-[3px] bg-gradient-to-b from-[#dcd9d4] to-[#bab7b1] sm:h-4">
          <span className="absolute top-0 left-1/2 h-1.5 w-[16%] -translate-x-1/2 rounded-b-[8px] bg-[#a6a39d]" />
        </div>
        <div className="mx-auto -mt-1 h-5 w-[88%] rounded-full bg-black/15 blur-xl" />
      </div>
    </div>
  );
}
