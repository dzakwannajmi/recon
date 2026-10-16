import { Nav } from "@/components/layout/nav";
import { AssetsList } from "@/components/landing/assets-list";
import { ChatSection } from "@/components/landing/chat-section";
import { Features } from "@/components/landing/features";
import { FinalCta } from "@/components/landing/final-cta";
import { Footer } from "@/components/landing/footer";
import { Hero } from "@/components/landing/hero";
import { HowItWorks } from "@/components/landing/how-it-works";
import { Problem } from "@/components/landing/problem";
import { WhyRecon } from "@/components/landing/why-recon";

export default function Page() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Problem />
        <WhyRecon />
        <HowItWorks />
        <Features />
        <AssetsList />
        <ChatSection />
        <FinalCta />
      </main>
      <Footer />
    </>
  );
}
