import { loadLandingStats } from "@/lib/factsheet/stats";
import { Container } from "./container";

/** The one full-width dark band: small uppercase labels, live counters read from the newest status file. */
export function Counters() {
  const s = loadLandingStats();
  const items = [
    { label: "Assets", value: String(s.assets) },
    { label: "Issuers", value: String(s.issuers) },
    { label: "Feed entries", value: String(s.feedEntries) },
    { label: "As of", value: s.asOf },
  ];
  return (
    <section aria-label="Live counters" className="bg-[#1a1919] py-12 text-white">
      <Container>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-8 md:grid-cols-4">
          {items.map((it) => (
            <div key={it.label}>
              <dt className="flex items-center gap-2 text-[10px] tracking-[0.18em] text-[#a8a6a1] uppercase">
                <span aria-hidden className="size-1.5 bg-primary" />
                {it.label}
              </dt>
              <dd className="mt-2 text-[28px] leading-[1.14] md:text-[40px] md:leading-[1.05]">{it.value}</dd>
            </div>
          ))}
        </dl>
      </Container>
    </section>
  );
}
