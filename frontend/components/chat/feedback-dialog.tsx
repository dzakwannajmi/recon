"use client";

import { Dialog } from "@base-ui/react/dialog";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FEEDBACK_REASONS, MAX_FEEDBACK_DETAIL } from "@/lib/history/rows";

export type FeedbackInput = { reason: string | null; detail: string };

const field = "w-full rounded-[8px] border bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-foreground";

/**
 * The box that opens after a thumbs up or down: an optional reason (thumbs down only) and an optional note.
 * Cancel keeps the rating off. Sending saves the rating, the note and the rated answer to the user's account.
 */
export function FeedbackDialog({ kind, open, onClose, onSend }: { kind: "up" | "down"; open: boolean; onClose: () => void; onSend: (input: FeedbackInput) => Promise<boolean> }) {
  const [reason, setReason] = useState("");
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const positive = kind === "up";

  async function send() {
    setBusy(true);
    setFailed(false);
    const ok = await onSend({ reason: reason || null, detail });
    setBusy(false);
    if (ok) {
      setReason("");
      setDetail("");
    } else setFailed(true);
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/20 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup className="fixed top-1/2 left-1/2 z-50 flex w-[calc(100vw-2rem)] max-w-[520px] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-[16px] border bg-card p-6 text-sm outline-none transition duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0">
          <Dialog.Title className="text-xl">{positive ? "Give positive feedback" : "Give negative feedback"}</Dialog.Title>
          {!positive && (
            <label className="flex flex-col gap-1.5">
              <span>What went wrong? <span className="text-muted-foreground">(optional)</span></span>
              <select className={field} value={reason} onChange={(e) => setReason(e.target.value)}>
                <option value="">Select…</option>
                {FEEDBACK_REASONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            </label>
          )}
          <label className="flex flex-col gap-1.5">
            <span>Add details <span className="text-muted-foreground">(optional)</span></span>
            <textarea
              className={`${field} min-h-24 resize-y`}
              maxLength={MAX_FEEDBACK_DETAIL}
              placeholder={positive ? "What did you like about this answer?" : "What could be better about this answer?"}
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
            />
          </label>
          <p className="text-xs text-muted-foreground">Sending saves your rating, your note and this answer to your account so we can improve Recon. It is not sent to the AI model.</p>
          {failed && <p role="alert" className="text-xs text-destructive">Could not send your feedback. Try again in a moment.</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" className="rounded-[6px]" disabled={busy} onClick={onClose}>Cancel</Button>
            <Button className="rounded-[6px]" disabled={busy} onClick={() => void send()}>Send</Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
