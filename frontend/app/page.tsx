import { Nav } from "@/components/layout/nav";
import { AsciiBackground } from "@/components/landing/ascii-background";
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
      {/* One ASCII field behind the whole page. Softer under the text column, clear at the edges. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 [mask-image:linear-gradient(to_right,black,rgba(0,0,0,0.45)_22%,rgba(0,0,0,0.45)_78%,black)]"
      >
        <AsciiBackground className="absolute inset-0" />
      </div>
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
