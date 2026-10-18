"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { decideAutoPay } from "@/lib/browser-payer/auto";
import { EXPLORER_ACCOUNT, EXPLORER_TX } from "@/lib/browser-payer/constants";
import type { Offer } from "@/lib/browser-payer/offer";
import { toBundleView } from "@/lib/browser-payer/bundle";
import { BundleBody } from "./evidence-bundle";
import { PaidBadge } from "./paid-badge";
import { usePayer } from "./use-payer";
import { useSavedEvidence } from "./use-saved-evidence";

const link = "inline-flex items-center gap-1 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-foreground";

/** One line per wallet state, written here. No amounts, no balances. */
const STATE_LINE = {
  missing: "No payer wallet in this browser yet.",
  not_funded: "The payer wallet has no test XLM yet, so it is not on the ledger and the explorer shows \"not found\". It appears after Friendbot funds it.",
  no_trustline: "The payer wallet needs the test USDC trustline.",
  no_usdc: "The payer wallet has no test USDC yet. Send test USDC from the Circle testnet faucet to the address above, then refresh.",
  ready: "Ready to unlock.",
} as const;

/**
 * "Unlock evidence": the USER pays for the detail with a testnet wallet kept in this browser (x402, Stellar testnet).
 * The agent never pays and never sees the result: the bundle is shown here and goes nowhere else.
 */
export function EvidenceCard({ offer, autoPayId }: { offer: Offer; /** Set only for a card made by a command the user typed (`/evidence CODE`): it may pay once, without a click, when the wallet is ready. */ autoPayId?: string }) {
  const p = usePayer();
  const keep = useSavedEvidence(offer, p.pay, p.raw);
  const [reopened, setReopened] = useState(false);

  // At most one decision per typed command (lib/browser-payer/auto.ts). A card the model offered has no id and never pays by itself.
  useEffect(() => {
    const d = decideAutoPay({ id: autoPayId, settled: p.settled, state: p.state, pay: p.pay.kind, hasUrl: Boolean(offer.available && offer.url) });
    if (d === "pay" && offer.url) void p.payFor(offer.url);
  });

  if (!offer.available || !offer.url) {
    return (
      <section aria-label="Unlock evidence" className="flex max-w-full flex-col gap-1 rounded-[10px] border bg-card px-3 py-2 text-xs">
        <p className="flex items-center gap-1.5 font-mono uppercase"><Lock className="size-3" /> Unlock evidence for {offer.assetCode}</p>
        <p className="text-muted-foreground">Paid detail is not available for this asset on this server right now. The free facts and flags are unchanged.</p>
      </section>
    );
  }
  const url = offer.url;
  const busy = p.busy !== null || p.pay.kind === "paying";

  return (
    <section aria-label="Unlock evidence" className="flex w-full max-w-[560px] flex-col gap-3 rounded-[10px] border bg-card p-3 text-xs">
      <p className="flex items-center gap-1.5 font-mono uppercase"><Lock className="size-3" /> Unlock evidence for {offer.assetCode}</p>
      <p className="text-muted-foreground">
        You pay with a Stellar testnet wallet kept in this browser. Test USDC has no value. The agent does not pay and does not see the evidence.
      </p>

      {p.address && (
        <div className="flex flex-col gap-1">
          <p className="font-mono text-muted-foreground uppercase">Payer wallet (testnet only)</p>
          <code className="font-mono break-all text-foreground">{p.address}</code>
          <a className={link} href={`${EXPLORER_ACCOUNT}/${p.address}`} target="_blank" rel="noreferrer">Explorer <ExternalLink className="size-3" /></a>
          {!p.kept && <p className="text-muted-foreground">Storage is blocked, so this wallet is lost when you close the page.</p>}
        </div>
      )}

      <div role="status" aria-live="polite" className="flex flex-col gap-1">
        {p.pay.kind === "idle" && <p>{p.snap === "unreadable" ? "Could not read the testnet account. Refresh to try again." : p.address && p.snap === null ? "Checking the wallet." : STATE_LINE[p.state]}</p>}
        {p.pay.kind === "paying" && <p>Paying. Do not close this page.</p>}
        {p.pay.kind === "failed" && <p role="alert" className="text-destructive">{p.pay.message}</p>}
        {p.pay.kind === "unknown" && (
          <p role="alert">
            The payment may have gone through, but the result did not arrive. Check the explorer before trying again.
            {p.pay.tx && <> <a className={link} href={`${EXPLORER_TX}/${p.pay.tx}`} target="_blank" rel="noreferrer">Transaction <ExternalLink className="size-3" /></a></>}
          </p>
        )}
        {p.pay.kind === "paid" && (
          <p className="flex flex-wrap items-center gap-2">
            <PaidBadge /> <a className={link} href={`${EXPLORER_TX}/${p.pay.tx}`} target="_blank" rel="noreferrer">Settlement transaction <ExternalLink className="size-3" /></a>
          </p>
        )}
        {p.notice && <p className="text-destructive">{p.notice}</p>}
      </div>

      <div className="flex flex-wrap gap-2">
        {p.state === "missing" && <Button size="sm" variant="outline" onClick={p.create}>Create testnet wallet</Button>}
        {p.state === "not_funded" && p.address && <Button size="sm" variant="outline" disabled={busy} onClick={() => void p.fund()}>Fund with Friendbot</Button>}
        {p.state === "no_trustline" && <Button size="sm" variant="outline" disabled={busy} onClick={() => void p.trust()}>Add test USDC trustline</Button>}
        {p.address && p.state !== "ready" && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void p.refresh()}>Refresh</Button>}
        {p.state === "ready" && (p.pay.kind === "idle" || p.pay.kind === "failed") && (
          <Button size="sm" disabled={busy} onClick={() => void p.payFor(url)}>Pay and unlock</Button>
        )}
        {p.pay.kind === "unknown" && <Button size="sm" variant="outline" onClick={p.acknowledge}>I checked the explorer</Button>}
        {p.address && p.pay.kind !== "paying" && <Button size="sm" variant="ghost" onClick={p.forget}>Forget wallet</Button>}
      </div>

      {keep.note && <p role="status" className="text-muted-foreground">{keep.note}</p>}
      {keep.saved && p.pay.kind !== "paid" && (
        <div className="flex flex-col gap-2">
          <PaidBadge label="Already paid" />
          <Button size="sm" variant="outline" className="w-fit" aria-expanded={reopened} onClick={() => setReopened(!reopened)}>
            {reopened ? "Hide saved evidence" : `Open saved (paid ${keep.saved.paid_at.slice(0, 10)})`}
          </Button>
          {reopened && (toBundleView(keep.saved.bundle) ? <BundleBody view={toBundleView(keep.saved.bundle)!} /> : <p role="alert">The saved bundle is not a recognised evidence bundle.</p>)}
        </div>
      )}

      {p.pay.kind === "paid" && (p.bundle ? <BundleBody view={p.bundle} raw={p.raw ?? undefined} /> : <p role="alert">The payment settled, but the response was not a recognised evidence bundle.</p>)}
    </section>
  );
}
