import { Bot, Flag, Languages, Network, Quote } from "lucide-react";
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
        {/* Six columns: three cards of two on the first row, two cards of three on the second. */}
        <ul className="mt-10 grid gap-4 md:mt-14 md:grid-cols-6 md:gap-6">
          {FEATURES.map((f, i) => (
            <li key={f.title} className={cn(cardCls, i < 3 ? "md:col-span-2" : "md:col-span-3")}>
              <IconTile icon={f.icon} />
              <h3 className="mt-2 text-xl leading-[1.3]">{f.title}</h3>
              <p className="text-muted-foreground">{f.body}</p>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
