/** The mascot, as tall as its parent: the plain cut-out, no effect. */
export const MASCOT_SRC = "/mascot.png";

export function Mascot({ className }: { className?: string }) {
  return (
    <div aria-hidden className={className}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={MASCOT_SRC} alt="" width={780} height={1203} className="absolute left-1/2 top-0 h-full w-auto max-w-none -translate-x-1/2" />
    </div>
  );
}
