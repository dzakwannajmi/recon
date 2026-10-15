import type { Status } from "./types";

export function ToolsList({ tools }: { tools: Status["tools"] | undefined }) {
  return (
    <div className="flex flex-col gap-4">
      {tools?.map((t) => (
        <div key={t.name}>
          <p className="font-mono text-sm">{t.name}</p>
          <p className="mt-1 text-muted-foreground">{t.description}</p>
        </div>
      ))}
      <p className="border-t pt-4 text-muted-foreground">Tools the agent can call. Every call it makes is shown in the chat.</p>
    </div>
  );
}
