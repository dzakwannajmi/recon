import { Container } from "./container";
import { Counters } from "./counters";
import { ProductFrame } from "./product-frame";

/** Demo video URL. Set it when the video is published; with null the slot is not rendered. */
export const DEMO_VIDEO_URL = null as string | null;

export function StatsExample() {
  return (
    <section aria-label="Stats and example" className="pb-16 md:pb-24">
      <Counters />
      <ProductFrame />
      {DEMO_VIDEO_URL && (
        <Container className="pt-16 md:pt-24">
          <figure>
            <div className="aspect-video overflow-hidden rounded-[16px] border bg-card">
              <iframe
                src={DEMO_VIDEO_URL}
                title="Demo video"
                loading="lazy"
                allowFullScreen
                referrerPolicy="no-referrer"
                className="size-full"
              />
            </div>
            <figcaption className="mt-4 text-sm text-muted-foreground">Demo video</figcaption>
          </figure>
        </Container>
      )}
    </section>
  );
}
