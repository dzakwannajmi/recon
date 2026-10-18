"use client";

import { useEffect, useRef, useState } from "react";
import { browserClient } from "@/lib/auth/client";
import { evidenceRowFor } from "@/lib/history/rows";
import { listEvidence, saveEvidence, type EvidenceItem } from "@/lib/history/store";
import { announceHistoryChanged } from "./use-history";
import { useAuth } from "@/components/auth/use-auth";
import type { Offer } from "@/lib/browser-payer/offer";

type Paid = { kind: string; tx?: string | null };

/**
 * Saved paid evidence for one Unlock card. Signed in: a bundle is saved once, only after the payment settled, from this
 * browser (never by the server and never sent to the model); an earlier saved bundle for the same asset can be opened
 * again for free. Signed out: nothing is read or written.
 */
export function useSavedEvidence(offer: Offer, pay: Paid, raw: string | null) {
  const auth = useAuth();
  const userId = auth.user?.id ?? null;
  const [saved, setSaved] = useState<EvidenceItem | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const done = useRef<string | null>(null);

  // The latest saved bundle for this asset and issuer.
  useEffect(() => {
    const db = browserClient();
    if (!db || !userId || !offer.issuer) return;
    let live = true;
    listEvidence(db, { assetCode: offer.assetCode, issuer: offer.issuer })
      .then((rows) => live && setSaved(rows[0] ?? null))
      .catch(() => live && setSaved(null));
    return () => void (live = false);
  }, [userId, offer.assetCode, offer.issuer]);

  // Save after a successful payment, once per settlement transaction.
  useEffect(() => {
    const row = evidenceRowFor({ userId, payKind: pay.kind, assetCode: offer.assetCode, issuer: offer.issuer, tx: pay.tx ?? null, raw });
    const db = browserClient();
    if (!row || !db || done.current === row.settlement_tx) return;
    done.current = row.settlement_tx;
    saveEvidence(db, row)
      .then(() => {
        setNote("Saved to your account.");
        announceHistoryChanged();
      })
      .catch(() => setNote("Could not save this evidence to your account. Download the JSON to keep it."));
  }, [userId, pay.kind, pay.tx, raw, offer.assetCode, offer.issuer]);

  // Derived, so signing out hides a bundle that was loaded earlier.
  return { signedIn: auth.status === "in", saved: userId ? saved : null, note };
}
