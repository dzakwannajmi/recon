import { loadLandingStats } from "@/lib/factsheet/stats";
import { Container } from "./container";

/** The one full-width dark band: small uppercase labels, counters read from the newest status file at build time. */
export function Counters() {
  const s = loadLandingStats();
  const items = [
    { label: "Assets", value: String(s.assets) },
    { label: "Issuers", value: String(s.issuers) },
    { label: "Assets with a status", value: String(s.feedEntries) },
    { label: "As of", value: s.asOf },
  ];
  return (
    <div className="bg-[#1a1919] py-12 text-white">
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
        <p className="mt-10 max-w-3xl text-xs text-[#a8a6a1]">
          Limits: Recon reads public documents only. Some issuer pages need a browser and cannot be read by a plain fetch, so a missing document can mean we could not read it. A flag shows a difference on a date. It does not say why. Issuer documents are treated as untrusted data.
        </p>
      </Container>
    </div>
  );
}
