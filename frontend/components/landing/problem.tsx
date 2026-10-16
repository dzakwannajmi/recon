import Image from "next/image";
import { FileClock, Hourglass, ScanSearch, Unlink } from "lucide-react";
import { Container, SectionHeading, cardCls } from "./container";
import { IconTile } from "./icon-tile";

const POINTS = [
  { icon: Unlink, text: "Documents sit in one place. Ledger data sits in another." },
  { icon: FileClock, text: "Documents are long PDFs and web pages. They can change." },
  { icon: Hourglass, text: "Checking them against the chain by hand, again and again, takes time." },
];

export function Problem() {
  return (
    <section aria-labelledby="problem-title" className="py-16 md:py-24">
      <Container className="flex flex-col items-center">
        <IconTile icon={ScanSearch} className="mb-6" />
        <SectionHeading id="problem-title" lead="Why issuer claims" tail="are hard to check" />
        <div className="mt-10 grid w-full items-center gap-8 md:mt-14 md:grid-cols-[2fr_3fr] md:gap-12">
          <Image
            src="/images/problem.webp"
            alt="A robot with a magnifying glass between a stack of papers and a tower of black and lime blocks."
            width={1000}
            height={722}
            sizes="(min-width: 768px) 40vw, 280px"
            className="mx-auto h-auto w-full max-w-[280px] md:max-w-none"
          />
          <ul className="flex flex-col gap-4 md:gap-6">
            {POINTS.map((p) => (
              <li key={p.text} className={cardCls}>
                <IconTile icon={p.icon} />
                <p className="mt-2 text-lg leading-[1.3]">{p.text}</p>
              </li>
            ))}
          </ul>
        </div>
      </Container>
    </section>
  );
}
