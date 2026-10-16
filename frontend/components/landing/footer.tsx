import { GITHUB_URL } from "@/components/layout/links";
import { Container } from "./container";

export function Footer() {
  return (
    <footer className="border-t bg-card py-10 text-sm">
      <Container className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col gap-1 text-muted-foreground">
          <p>MIT licensed. Third-party notices are in the repo.</p>
          <p>This is information, not investment advice.</p>
          <p>Built for the Rise In Agentmaxxing program.</p>
        </div>
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="w-fit rounded-[6px] underline underline-offset-4 hover:bg-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
        >
          GitHub
        </a>
      </Container>
    </footer>
  );
}
