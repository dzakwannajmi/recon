import { Footer } from "@/components/layout/footer";
import { Nav } from "@/components/layout/nav";
import { Counters } from "@/components/landing/counters";
import { Hero } from "@/components/landing/hero";
import { HowItWorks } from "@/components/landing/how-it-works";
import { Limits } from "@/components/landing/limits";
import { Scope } from "@/components/landing/scope";
import { WhatWeCheck } from "@/components/landing/what-we-check";
import { WhatYouGet } from "@/components/landing/what-you-get";

export default function Page() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <HowItWorks />
        <WhatYouGet />
        <WhatWeCheck />
        <Scope />
        <Limits />
        <Counters />
      </main>
      <Footer />
    </>
  );
}
