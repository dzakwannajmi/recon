/**
 * Summary of what a re-check changed (spec 4.10): the new status against the newest published one.
 * Asset codes and flag names only; no judgment words. Pure.
 */
import type { StatusDiff, StatusDiffItem } from "./types";

type StatusLike = {
  assets: { asset: string; asset_code: string; status: string | null; flags_bitmask: number; raised: { flag: string }[] }[];
};

/** @param against the status file name the newest log record names (for the report), or null */
export function diffStatus(previous: StatusLike | null, next: StatusLike, against: string | null): StatusDiff {
  const before = new Map((previous?.assets ?? []).map((a) => [a.asset, a]));
  const items: StatusDiffItem[] = [];
  for (const a of next.assets) {
    const p = before.get(a.asset);
    const now = new Set(a.raised.map((r) => r.flag));
    const was = new Set((p?.raised ?? []).map((r) => r.flag));
    const raised = [...now].filter((f) => !was.has(f));
    const cleared = [...was].filter((f) => !now.has(f));
    const same = (p?.status ?? null) === a.status && (p?.flags_bitmask ?? 0) === a.flags_bitmask;
    if (p && same && raised.length === 0 && cleared.length === 0) continue;
    if (!p && a.status === null && raised.length === 0) continue;
    items.push({
      asset: a.asset_code, status_from: p?.status ?? null, status_to: a.status, bitmask_from: p?.flags_bitmask ?? 0, bitmask_to: a.flags_bitmask, raised, cleared,
    });
  }
  return { against, items };
}

/** One line per changed asset. */
export function describeDiff(d: StatusDiff): string[] {
  if (d.items.length === 0) return [`no status change against ${d.against ?? "the previous status"}`];
  return d.items.map((i) => {
    const parts = [`${i.asset}: ${i.status_from ?? "none"} -> ${i.status_to ?? "none"}`, `flags ${i.bitmask_from} -> ${i.bitmask_to}`];
    if (i.raised.length) parts.push(`raised ${i.raised.join(", ")}`);
    if (i.cleared.length) parts.push(`cleared ${i.cleared.join(", ")}`);
    return parts.join("; ");
  });
}
