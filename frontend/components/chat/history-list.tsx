"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toBundleView } from "@/lib/browser-payer/bundle";
import type { EvidenceItem, SessionItem } from "@/lib/history/store";
import { BundleBody } from "./evidence-bundle";
import { PaidBadge } from "./paid-badge";

type Props = {
  sessions: SessionItem[];
  evidence: EvidenceItem[];
  current: string | null;
  error: string | null;
  busy: boolean;
  onNew: () => void;
  onOpen: (id: string) => void;
  onRemove: (id: string) => void;
  onRemoveEvidence: (id: string) => void;
};

const row = "flex min-w-0 items-center gap-1";
const open = "min-w-0 flex-1 truncate rounded-[6px] px-2 py-1.5 text-left text-sm hover:bg-secondary focus-visible:outline-2 focus-visible:outline-foreground";
const when = (iso: string) => iso.slice(0, 10);

/** The signed-in user's saved chats and saved paid evidence. Titles and bundles are plain text (React escapes them). */
export function HistoryList({ sessions, evidence, current, error, busy, onNew, onOpen, onRemove, onRemoveEvidence }: Props) {
  const [shown, setShown] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-6">
      <section id="saved-chats" aria-label="Saved chats" className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="font-mono text-xs uppercase text-muted-foreground">Saved chats</h2>
          <Button variant="ghost" size="sm" className="rounded-[6px]" onClick={onNew} disabled={busy}><Plus /> New chat</Button>
        </div>
        {sessions.length === 0 && <p className="text-xs text-muted-foreground">No saved chats yet. Each answer you get is saved here.</p>}
        <ul className="flex flex-col gap-0.5">
          {sessions.map((s) => (
            <li key={s.id} className={row}>
              <button type="button" className={`${open} ${current === s.id ? "bg-secondary" : ""}`} aria-current={current === s.id} disabled={busy} onClick={() => onOpen(s.id)}>
                {s.title}
              </button>
              <Button variant="ghost" size="icon-sm" aria-label={`Delete chat ${s.title}`} onClick={() => onRemove(s.id)}><Trash2 /></Button>
            </li>
          ))}
        </ul>
      </section>

      <section id="saved-evidence" aria-label="Saved evidence" className="flex flex-col gap-2">
        <h2 className="font-mono text-xs uppercase text-muted-foreground">Saved evidence</h2>
        {evidence.length === 0 && <p className="text-xs text-muted-foreground">Evidence you unlock while signed in is kept here. Opening it again is free.</p>}
        <ul className="flex flex-col gap-0.5">
          {evidence.map((e) => {
            const view = shown === e.id ? toBundleView(e.bundle) : null;
            return (
              <li key={e.id} className="flex flex-col gap-2">
                <div className={row}>
                  <button type="button" className={open} aria-expanded={shown === e.id} onClick={() => setShown(shown === e.id ? null : e.id)}>
                    {e.asset_code} <span className="text-muted-foreground">{when(e.paid_at)}</span> <PaidBadge />
                  </button>
                  <Button variant="ghost" size="icon-sm" aria-label={`Delete saved evidence for ${e.asset_code}`} onClick={() => onRemoveEvidence(e.id)}><Trash2 /></Button>
                </div>
                {shown === e.id && (view ? <BundleBody view={view} /> : <p role="alert" className="text-xs">This saved bundle is not a recognised evidence bundle.</p>)}
              </li>
            );
          })}
        </ul>
      </section>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
