import { COPY } from "@/lib/factsheet/copy";
import { loadStatus, type StatusFile } from "@/lib/factsheet/load";
import { safeHttpUrl } from "@/lib/factsheet/view";
import { pickSample } from "./sample";

export type FeedStatus = "OK" | "WARNING" | "CRITICAL";

/** Everything the landing page shows about its sample asset. Each field is copied from the status file; nothing is composed. */
export type Demo = {
  code: string;
  issuerOrg: string;
  status: FeedStatus;
  /** As-of date of the status file. */
  asOf: string;
  flagName: string;
  /** The flag statement, written by code in the required form. */
  statement: string;
  /** The on-chain part of the statement, e.g. "supply 2668351.5866776", or null when the statement has no such part. */
  onchain: string | null;
  quote: string;
  where: string | null;
  sourceUrl: string | null;
  sha256: string | null;
};

const ONCHAIN = /\bon-chain (\S.*?) as of \d{4}-\d{2}-\d{2}\b/;

/** The value after "on-chain" in a flag statement, read back out of the sentence code wrote. Null if the form is not found. */
export function onchainFrom(statement: string): string | null {
  return ONCHAIN.exec(statement)?.[1] ?? null;
}

/** The sample asset as the landing page shows it, or null when no asset has a flag backed by a quote. */
export function buildDemo(status: Pick<StatusFile, "assets" | "as_of">): Demo | null {
  const sample = pickSample(status);
  if (!sample) return null;
  const { asset, flag, quote } = sample;
  // A raised flag always comes with a status; without one there is nothing to show.
  if (asset.status === null) return null;
  return {
    code: asset.asset_code,
    issuerOrg: asset.issuer_org,
    status: asset.status,
    asOf: status.as_of,
    flagName: COPY.en.flags[flag.flag]?.name ?? flag.flag,
    statement: flag.statement,
    onchain: onchainFrom(flag.statement),
    quote: quote.quote,
    where: quote.where ?? null,
    sourceUrl: safeHttpUrl(quote.source_url) ?? quote.source_url ?? null,
    sha256: quote.snapshot_sha256 ?? null,
  };
}

export const loadDemo = (): Demo | null => buildDemo(loadStatus().status);
