import { Footer } from "@/components/layout/footer";
import { Nav } from "@/components/layout/nav";
import { Counters } from "@/components/landing/counters";
import { Hero } from "@/components/landing/hero";
import { HowItWorks } from "@/components/landing/how-it-works";
import { ProductFrame } from "@/components/landing/product-frame";

export default function Page() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <ProductFrame />
        <HowItWorks />
        <Counters />
      </main>
      <Footer />
    </>
  );
}
