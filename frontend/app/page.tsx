import { Nav } from "@/components/layout/nav";
import { ChatSection } from "@/components/landing/chat-section";
import { Features } from "@/components/landing/features";
import { FinalCta } from "@/components/landing/final-cta";
import { Footer } from "@/components/landing/footer";
import { Hero } from "@/components/landing/hero";
import { HowItWorks } from "@/components/landing/how-it-works";
import { Problem } from "@/components/landing/problem";

export default function Page() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Problem />
        <HowItWorks />
        <Features />
        <ChatSection />
        <FinalCta />
      </main>
      <Footer />
    </>
  );
}
