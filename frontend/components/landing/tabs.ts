import type { Demo, FeedStatus } from "./demo";

export const STEPS = [
  {
    title: "The model finds and reads",
    body: "An LLM reads the issuer's documents and extracts claims, each with an exact quote.",
  },
  {
    title: "Code checks the quote and the chain",
    body: "Code confirms the quote appears word for word, then compares the claim with Stellar mainnet data.",
  },
  {
    title: "The result goes to a Soroban feed",
    body: "Flags and facts are written to a Soroban contract on Stellar testnet.",
  },
] as const;

export type Row = { label: string; value: string; mono?: boolean; status?: FeedStatus };

/** The real data shown with each step. A row is left out when the data has no value for it. */
export function stepRows(d: Demo, step: number): Row[] {
  const rows: (Row | null)[] =
    step === 0
      ? [
          { label: "Quote", value: d.quote, mono: true },
          d.sourceUrl ? { label: "Source", value: d.sourceUrl } : null,
          d.where ? { label: "Location", value: d.where } : null,
        ]
      : step === 1
        ? [
            d.onchain ? { label: "On-chain", value: `${d.onchain} (as of ${d.asOf})` } : { label: "Flag", value: d.statement },
            { label: "Quote", value: d.quote, mono: true },
            d.sha256 ? { label: "Document hash", value: d.sha256, mono: true } : null,
          ]
        : [
            { label: "Asset", value: d.code },
            { label: "Status", value: d.status, status: d.status },
            { label: "As of", value: d.asOf },
          ];
  return rows.filter((r): r is Row => r !== null);
}

/** The tab to move to for an arrow, Home or End key; null for any other key. Wraps around. */
export function nextTab(index: number, key: string, count: number): number | null {
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (index + 1) % count;
    case "ArrowLeft":
    case "ArrowUp":
      return (index - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}
