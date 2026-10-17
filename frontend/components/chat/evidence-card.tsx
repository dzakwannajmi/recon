"use client";

import { ExternalLink, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EXPLORER_ACCOUNT, EXPLORER_TX } from "@/lib/browser-payer/constants";
import type { Offer } from "@/lib/browser-payer/offer";
import { BundleBody } from "./evidence-bundle";
import { usePayer } from "./use-payer";

const link = "inline-flex items-center gap-1 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-foreground";

/** One line per wallet state, written here. No amounts, no balances. */
const STATE_LINE = {
  missing: "No payer wallet in this browser yet.",
  not_funded: "The payer wallet has no test XLM yet.",
  no_trustline: "The payer wallet needs the test USDC trustline.",
  no_usdc: "The payer wallet has no test USDC yet. Send test USDC from the Circle testnet faucet to the address above, then refresh.",
  ready: "Ready to unlock.",
} as const;

/**
 * "Unlock evidence": the USER pays for the detail with a testnet wallet kept in this browser (x402, Stellar testnet).
 * The agent never pays and never sees the result: the bundle is shown here and goes nowhere else.
 */
export function EvidenceCard({ offer }: { offer: Offer }) {
  const p = usePayer();

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
          <p>
            Paid. <a className={link} href={`${EXPLORER_TX}/${p.pay.tx}`} target="_blank" rel="noreferrer">Settlement transaction <ExternalLink className="size-3" /></a>
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

      {p.pay.kind === "paid" && (p.bundle ? <BundleBody view={p.bundle} /> : <p role="alert">The payment settled, but the response was not a recognised evidence bundle.</p>)}
    </section>
  );
}
