import { Nav } from "@/components/layout/nav";
import { Features } from "@/components/landing/features";
import { FinalCta } from "@/components/landing/final-cta";
import { Footer } from "@/components/landing/footer";
import { Hero } from "@/components/landing/hero";
import { HowItWorks } from "@/components/landing/how-it-works";
import { Problem } from "@/components/landing/problem";
import { StatsExample } from "@/components/landing/stats-example";

export default function Page() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Problem />
        <HowItWorks />
        <Features />
        <StatsExample />
        <FinalCta />
      </main>
      <Footer />
    </>
  );
}
