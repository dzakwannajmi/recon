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
        <ul className="mt-10 grid w-full gap-4 md:mt-14 md:grid-cols-3 md:gap-6">
          {POINTS.map((p) => (
            <li key={p.text} className={cardCls}>
              <IconTile icon={p.icon} />
              <p className="mt-2 text-lg leading-[1.3]">{p.text}</p>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
