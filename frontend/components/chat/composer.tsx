import { SendHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Props = { value: string; onChange: (v: string) => void; onSend: (v: string) => void; ready: boolean; thinking: boolean };

export function Composer({ value, onChange, onSend, ready, thinking }: Props) {
  return (
    <form
      className="flex w-full gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSend(value);
      }}
    >
      <div className={cn("flex min-w-0 flex-1 items-center rounded-[10px] border border-input bg-background focus-within:border-foreground", !ready && "opacity-50")}>
        <span className="pl-3 font-mono text-base whitespace-nowrap text-muted-foreground md:text-sm">~/agent $</span>
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={ready ? "ask your agent something..." : "add your API key to start"}
          aria-label="Message to the agent"
          disabled={!ready}
          className="h-11 min-w-0 border-0 bg-transparent font-mono focus-visible:ring-0 disabled:bg-transparent disabled:opacity-100 dark:bg-transparent dark:disabled:bg-transparent"
        />
      </div>
      <Button type="submit" className="h-auto rounded-[6px] px-5" disabled={!ready || thinking || !value.trim()} aria-label="Send">
        <SendHorizontal />
      </Button>
    </form>
  );
}
