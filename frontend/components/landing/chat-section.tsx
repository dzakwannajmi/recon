import { ButtonLink } from "@/components/ui/button-link";
import { DEMO_HREF } from "@/components/layout/links";
import { ChatDemo } from "./chat-demo";
import { Container, SectionHeading } from "./container";
import { loadDemo } from "./demo";
import { Laptop } from "./laptop";
import { buildScript } from "./script";

/** A laptop showing a scripted sample check of the sample asset. Text comes from the status file at build time. */
export function ChatSection() {
  const demo = loadDemo();
  if (!demo) return null;
  return (
    <section aria-labelledby="chat-title" className="overflow-x-clip py-16 md:py-24">
      <Container>
        <SectionHeading id="chat-title" lead="Ask the agent" tail="about an asset." />
        <p className="mx-auto mt-4 max-w-xl text-center text-lg text-muted-foreground">
          A sample check on {demo.code}, replayed from the published fact sheet. It makes no live request.
        </p>
      </Container>
      {/* Wider than the text column so the laptop can use up to 1200px. */}
      <div className="mx-auto mt-10 w-full max-w-[1264px] px-4 sm:px-8 md:mt-14">
        {/* The screen is a picture of the chat: nothing in it takes focus or input. */}
        <div inert>
          <Laptop>
            <ChatDemo script={buildScript(demo)} />
          </Laptop>
        </div>
      </div>
      <Container>
        <div className="mt-10 flex justify-center">
          <ButtonLink href={DEMO_HREF}>Try the agent</ButtonLink>
        </div>
      </Container>
    </section>
  );
}
