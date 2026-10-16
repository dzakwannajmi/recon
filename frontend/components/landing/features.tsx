import { Bot, Flag, Languages, Network, Quote } from "lucide-react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { Container, SectionHeading, cardCls } from "./container";
import { IconTile } from "./icon-tile";

const FEATURES = [
  { icon: Quote, title: "No quote, no claim", body: "Recon drops any claim that lacks a word-for-word quote in the saved document." },
  { icon: Flag, title: "Code sets the flags", body: "Fixed rules in code set every flag. The AI sets none." },
  { icon: Languages, title: "English and Indonesian", body: "Fact sheets come in both languages." },
  { icon: Network, title: "Reads mainnet, writes testnet", body: "Recon reads the live Stellar network (mainnet). It writes only to the Stellar test network (testnet)." },
  { icon: Bot, title: "Access for other agents", body: "Other AI agents can ask Recon for checks. A detailed check can be requested with a test payment on testnet." },
];

export function Features() {
  return (
    <section id="key-features" aria-labelledby="features-title" className="scroll-mt-16 py-16 md:py-24">
      <Container>
        <SectionHeading id="features-title" lead="Key" tail="features" />
        <div className="mt-10 grid items-start gap-8 md:mt-14 md:grid-cols-[2fr_3fr] md:gap-12">
          <Image
            src="/images/features.webp"
            alt="A robot leaning on a lime shield that holds a quotation mark."
            width={972}
            height={841}
            sizes="(min-width: 768px) 40vw, 280px"
            className="mx-auto h-auto w-full max-w-[280px] md:sticky md:top-24 md:max-w-none"
          />
          <ul className="grid gap-4 sm:grid-cols-2 md:gap-6">
            {FEATURES.map((f, i) => (
              <li key={f.title} className={cn(cardCls, i === FEATURES.length - 1 && "sm:col-span-2")}>
                <IconTile icon={f.icon} />
                <h3 className="mt-2 text-xl leading-[1.3]">{f.title}</h3>
                <p className="text-muted-foreground">{f.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </Container>
    </section>
  );
}
