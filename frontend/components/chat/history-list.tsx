"use client";

import { useState } from "react";
import { Pencil, Pin, PinOff, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toBundleView } from "@/lib/browser-payer/bundle";
import type { EvidenceItem, SessionItem } from "@/lib/history/store";
import { BundleBody } from "./evidence-bundle";
import { PaidBadge } from "./paid-badge";
import { RowMenu } from "./row-menu";

type Props = {
  sessions: SessionItem[];
  evidence: EvidenceItem[];
  current: string | null;
  error: string | null;
  busy: boolean;
  onNew: () => void;
  onOpen: (id: string) => void;
  onRemove: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onRemoveEvidence: (id: string) => void;
};

const row = "flex min-w-0 items-center gap-1";
const open = "min-w-0 flex-1 truncate rounded-[6px] px-2 py-1.5 text-left text-sm hover:bg-secondary focus-visible:outline-2 focus-visible:outline-foreground";
const when = (iso: string) => iso.slice(0, 10);

/** The signed-in user's saved chats and saved paid evidence. Titles and bundles are plain text (React escapes them). */
export function HistoryList({ sessions, evidence, current, error, busy, onNew, onOpen, onRemove, onRename, onPin, onRemoveEvidence }: Props) {
  const [shown, setShown] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
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
              {editing === s.id ? (
                <input
                  autoFocus
                  aria-label="Chat name"
                  maxLength={120}
                  value={draft}
                  className="min-w-0 flex-1 rounded-[6px] border bg-background px-2 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-foreground"
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => setEditing(null)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setEditing(null);
                    if (e.key === "Enter") {
                      if (draft.trim() !== "" && draft.trim() !== s.title) onRename(s.id, draft);
                      setEditing(null);
                    }
                  }}
                />
              ) : (
                <button type="button" className={`${open} ${current === s.id ? "bg-secondary" : ""}`} aria-current={current === s.id} disabled={busy} onClick={() => onOpen(s.id)}>
                  {s.pinned && <Pin aria-label="Pinned" className="mr-1 inline size-3 -translate-y-px text-muted-foreground" />}
                  {s.title}
                </button>
              )}
              <RowMenu
                label={`Options for chat ${s.title}`}
                actions={[
                  { label: s.pinned ? "Unpin" : "Pin", icon: s.pinned ? <PinOff /> : <Pin />, onSelect: () => onPin(s.id, !s.pinned) },
                  { label: "Rename", icon: <Pencil />, onSelect: () => { setDraft(s.title); setEditing(s.id); } },
                  { label: "Delete", icon: <Trash2 />, onSelect: () => onRemove(s.id), destructive: true },
                ]}
              />
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
                  <RowMenu label={`Options for saved evidence ${e.asset_code}`} actions={[{ label: "Delete", icon: <Trash2 />, onSelect: () => onRemoveEvidence(e.id), destructive: true }]} />
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
