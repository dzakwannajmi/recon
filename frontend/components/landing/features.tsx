import { Bot, Flag, Languages, Network, Quote } from "lucide-react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { Container, SectionHeading, cardCls } from "./container";
import { IconTile } from "./icon-tile";

const FEATURES = [
  { icon: Quote, title: "Quote or discard", body: "A claim without a verbatim quote in the saved document is dropped." },
  { icon: Flag, title: "Flags set by code", body: "Flags come from deterministic code. The model never sets one." },
  { icon: Languages, title: "English and Indonesian", body: "Fact sheets are available in both languages." },
  { icon: Network, title: "Reads mainnet, writes testnet", body: "Recon reads Stellar mainnet and writes only to Stellar testnet." },
  { icon: Bot, title: "Agent access", body: "Other agents can query checks through MCP. A detailed check can settle through x402 on Stellar testnet." },
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
