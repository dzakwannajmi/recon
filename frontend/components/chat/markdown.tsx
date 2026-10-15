import type { ReactNode } from "react";
import { parseMarkdown, type Block, type Inline } from "./markdown-parse";

/** Chat answer as markdown. Builds React elements only: no raw HTML, no images, http(s) links only. */

function Inlines({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.t) {
          case "text":
            return n.text;
          case "br":
            return <br key={i} />;
          case "code":
            return (
              <code key={i} className="rounded-[6px] bg-secondary px-1 py-0.5 font-mono text-[0.85em] break-all">
                {n.text}
              </code>
            );
          case "strong":
            // Weight 400 only in this design: bold is a chartreuse underline, not a heavier face.
            return (
              <strong key={i} className="font-normal underline decoration-primary decoration-[3px] underline-offset-2">
                <Inlines nodes={n.children} />
              </strong>
            );
          case "em":
            return (
              <em key={i} className="italic">
                <Inlines nodes={n.children} />
              </em>
            );
          case "link":
            return (
              <a
                key={i}
                href={n.href}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all underline underline-offset-4 hover:bg-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
              >
                <Inlines nodes={n.children} />
              </a>
            );
        }
      })}
    </>
  );
}

const HEADING_CLASS = ["text-xl", "text-xl", "text-lg", "text-base", "text-base", "text-sm"];

function Blocks({ blocks }: { blocks: Block[] }): ReactNode {
  return blocks.map((b, i) => {
    switch (b.t) {
      case "heading": {
        // Chat answers sit under the page's own h1/h2, so markdown level 1 renders as h3.
        const Tag = `h${Math.min(6, b.level + 2)}` as "h3" | "h4" | "h5" | "h6";
        return (
          <Tag key={i} className={`${HEADING_CLASS[b.level - 1]} leading-snug tracking-tight`}>
            <Inlines nodes={b.children} />
          </Tag>
        );
      }
      case "p":
        return (
          <p key={i}>
            <Inlines nodes={b.children} />
          </p>
        );
      case "code":
        return (
          <pre key={i} className="rounded-[10px] bg-secondary p-3 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap">
            <code>{b.text}</code>
          </pre>
        );
      case "hr":
        return <hr key={i} className="border-border" />;
      case "quote":
        return (
          <blockquote key={i} className="flex flex-col gap-2 border-l-4 border-primary pl-3 text-muted-foreground">
            <Blocks blocks={b.blocks} />
          </blockquote>
        );
      case "list": {
        const Tag = b.ordered ? "ol" : "ul";
        return (
          <Tag key={i} start={b.ordered ? b.start : undefined} className={`space-y-1 pl-5 ${b.ordered ? "list-decimal" : "list-disc"}`}>
            {b.items.map((item, j) => (
              <li key={j} className="pl-1 marker:text-muted-foreground [&>*+*]:mt-1">
                <Blocks blocks={item} />
              </li>
            ))}
          </Tag>
        );
      }
    }
  });
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={`flex min-w-0 flex-col gap-2 [overflow-wrap:anywhere] ${className ?? ""}`}>
      <Blocks blocks={parseMarkdown(text)} />
    </div>
  );
}
