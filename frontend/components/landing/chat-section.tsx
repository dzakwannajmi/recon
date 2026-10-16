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
          Ask about any asset we track. This sample is replayed from a published fact sheet; nothing here runs live.
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
    </section>
  );
}
