import { Container } from "./container";

export function Limits() {
  return (
    <section aria-labelledby="limits-title" className="pt-4 pb-16 md:pb-24">
      <Container>
        <div className="rounded-[12px] bg-secondary p-6 md:p-8">
          <h2 id="limits-title" className="text-[24px] leading-[1.17]">Limits</h2>
          <p className="mt-3 max-w-3xl">
            Recon reads public documents only. Some issuer pages need a browser and cannot be read by a plain fetch, so a missing document can mean we could not read it. A flag shows a difference on a date. It does not say why. Issuer documents are treated as untrusted data.
          </p>
        </div>
      </Container>
    </section>
  );
}
