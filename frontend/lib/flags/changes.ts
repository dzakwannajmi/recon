import type { AssetFlags } from "../chain/horizon";
import { chainRef, clear, day, notEvaluated, raised, type ChecksRow, type Evaluation, type FlagName } from "./types";

const FLAG_KEYS = ["auth_required", "auth_revocable", "auth_immutable", "auth_clawback_enabled"] as const satisfies readonly (keyof AssetFlags)[];
type Thresholds = { low: number; medium: number; high: number };

/** "GABC…WXYZ": first 4 and last 4 characters. */
const short = (key: string) => `${key.slice(0, 4)}…${key.slice(-4)}`;

/** Both rows usable for a comparison, or the reason they are not. */
function pair(flag: FlagName, previous: ChecksRow | undefined, current: ChecksRow | undefined, need: (r: ChecksRow) => boolean, what: string) {
  if (!previous) return { skip: notEvaluated(flag, "No previous chain check for this asset to compare with") };
  if (!current) return { skip: notEvaluated(flag, "No chain check for this asset in the current checks file") };
  for (const [name, r] of [["previous", previous], ["current", current]] as const) {
    if (r.error || !r.facts) return { skip: notEvaluated(flag, `The ${name} chain check failed or has no on-chain facts`) };
    if (!need(r)) return { skip: notEvaluated(flag, `The ${name} chain check has no ${what}`) };
  }
  return { prev: previous.facts!, cur: current.facts!, dates: [day(previous.facts!.checkedAt), day(current.facts!.checkedAt)] as const };
}

/** FLAG_CHANGE (WARNING only): any of the four issuer authorization flags differs between two checks. */
export function flagFlagChange(previous: ChecksRow | undefined, current: ChecksRow | undefined): Evaluation {
  const p = pair("FLAG_CHANGE", previous, current, (r) => !!r.facts?.flags, "authorization flags");
  if (p.skip) return p.skip;
  const [from, to] = [p.prev.flags!, p.cur.flags!];
  const evidence = [chainRef(previous!), chainRef(current!)];
  const changes = FLAG_KEYS.filter((k) => from[k] !== to[k]).map((k) => `${k} ${from[k]} → ${to[k]}`);
  if (changes.length === 0) return clear("FLAG_CHANGE", `The issuer authorization flags are the same on ${p.dates[0]} and ${p.dates[1]}.`, p.dates[1], evidence);
  return raised("FLAG_CHANGE", "WARNING", `Issuer authorization flags changed between checks on ${p.dates[0]} and ${p.dates[1]}: ${changes.join(", ")}.`, p.dates[1], evidence);
}

/** SIGNER_CHANGE (WARNING only): the issuer's signers (key to weight) or thresholds differ between two checks. */
export function flagSignerChange(previous: ChecksRow | undefined, current: ChecksRow | undefined): Evaluation {
  const p = pair("SIGNER_CHANGE", previous, current, (r) => !!r.facts?.issuerSigners && !!r.facts?.issuerThresholds, "signers or thresholds");
  if (p.skip) return p.skip;
  const [from, to] = [new Map(p.prev.issuerSigners!.map((s) => [s.key, s.weight])), new Map(p.cur.issuerSigners!.map((s) => [s.key, s.weight]))];
  const changes: string[] = [];
  for (const [key, weight] of to) if (!from.has(key)) changes.push(`added ${short(key)}(weight ${weight})`);
  for (const [key, weight] of from) if (!to.has(key)) changes.push(`removed ${short(key)}(weight ${weight})`);
  for (const [key, weight] of to) if (from.has(key) && from.get(key) !== weight) changes.push(`${short(key)} weight ${from.get(key)} → ${weight}`);
  const [tFrom, tTo]: Thresholds[] = [p.prev.issuerThresholds!, p.cur.issuerThresholds!];
  for (const level of ["low", "medium", "high"] as const) if (tFrom[level] !== tTo[level]) changes.push(`${level} threshold ${tFrom[level]} → ${tTo[level]}`);
  const evidence = [chainRef(previous!), chainRef(current!)];
  if (changes.length === 0) return clear("SIGNER_CHANGE", `The issuer signers and thresholds are the same on ${p.dates[0]} and ${p.dates[1]}.`, p.dates[1], evidence);
  return raised("SIGNER_CHANGE", "WARNING", `Issuer signers or thresholds changed between checks on ${p.dates[0]} and ${p.dates[1]}: ${changes.join("; ")}.`, p.dates[1], evidence, {
    added: [...to].filter(([k]) => !from.has(k)).map(([key, weight]) => ({ key, weight })),
    removed: [...from].filter(([k]) => !to.has(k)).map(([key, weight]) => ({ key, weight })),
    changed: [...to].filter(([k, w]) => from.has(k) && from.get(k) !== w).map(([key, weight]) => ({ key, from: from.get(key), to: weight })),
    thresholds: { from: tFrom, to: tTo },
  });
}
