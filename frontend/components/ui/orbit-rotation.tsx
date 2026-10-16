import { cn } from "@/lib/utils";

/** `href` is an external site: the link opens it in a new tab. */
export type OrbitItem = { href: string; src: string | null; name: string; short: string };

/** Rings from the inside out: width cap in rem, and the viewport-width cap that keeps it on a phone. */
const RINGS = [
  { rem: 24, vw: 56, duration: 70 },
  { rem: 40, vw: 76, duration: 95 },
  { rem: 56, vw: 94, duration: 120 },
] as const;

/** Flattened circles are twice as wide as tall. */
const FLAT = 0.5;

/**
 * Logos on three tilted rings. Each ring is a circle squashed to an ellipse and turned; every logo counter-turns
 * and counter-squashes so it stays upright and round. Pure CSS (orbit-spin / orbit-counter in globals.css):
 * it renders on the server, pauses on hover or focus so a logo can be clicked, and stops under reduced motion.
 */
export function OrbitRotation({ items, className }: { items: OrbitItem[]; className?: string }) {
  // Share the logos between the rings in proportion to each ring's length.
  const total = RINGS.reduce((n, r) => n + r.rem, 0);
  let from = 0;
  const rings = RINGS.map((r, i) => {
    const count = i === RINGS.length - 1 ? items.length - from : Math.round((items.length * r.rem) / total);
    const slice = items.slice(from, from + count);
    from += count;
    return { ...r, slice };
  });
  const outer = RINGS[RINGS.length - 1];
  return (
    <nav
      aria-label="Assets we check"
      className={cn("orbit relative mx-auto flex w-full items-center justify-center overflow-hidden", className)}
      style={{ height: `calc(min(${outer.rem}rem, ${outer.vw}vw) * ${FLAT} + 5rem)` }}
    >
      {rings.map((ring, o) => {
        const size = `min(${ring.rem}rem, ${ring.vw}vw)`;
        const direction = o % 2 ? "reverse" : "normal";
        return (
          <div key={o} className="absolute" style={{ width: size, height: size, transform: `scaleY(${FLAT})` }}>
            <ul
              className="orbit-ring absolute inset-0 m-0 list-none rounded-full border border-dashed border-muted-foreground/40 p-0"
              style={{ animationDuration: `${ring.duration}s`, animationDirection: direction }}
            >
              {ring.slice.map((item, i) => {
                const angle = (i / ring.slice.length) * 2 * Math.PI + o * 0.7;
                return (
                  <li
                    key={item.href}
                    className="absolute w-max"
                    style={{ left: `${50 + 50 * Math.cos(angle)}%`, top: `${50 + 50 * Math.sin(angle)}%`, translate: "-50% -50%" }}
                  >
                    <a
                      href={item.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={item.name}
                      aria-label={`${item.name} (opens its site)`}
                      className="orbit-logo flex size-14 items-center justify-center rounded-full transition-transform hover:scale-125 focus-visible:scale-125 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground md:size-[4.5rem]"
                      style={{ animationDuration: `${ring.duration}s`, animationDirection: direction }}
                    >
                      {item.src ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.src} alt="" width={72} height={72} loading="lazy" className="size-full rounded-[18%] object-contain" />
                      ) : (
                        <span aria-hidden className="text-sm text-muted-foreground">
                          {item.short}
                        </span>
                      )}
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
