/**
 * FLAG_CHANGE and SIGNER_CHANGE with a hold window (D-038). Pure: the same
 * series of stored checks always gives the same result. There is no clock read
 * here: the window runs in check time (the day of the current check), so a status
 * run without new checks never clears a flag.
 *
 * One event computation (`changeEvents`) feeds both deciders and
 * `issuerChangeSeenAt`, so the flag and the feed's change time can't disagree.
 */
import type { AssetFacts } from "../chain/asset";
import type { AssetFlags } from "../chain/horizon";
import { chainRef, clear, day, isIsoDay, notEvaluated, raised, type ChecksRow, type Evaluation, type EvidenceRef } from "./types";

/** A change stays raised (WARNING) until this many days after the day it was first seen. */
export const CHANGE_HOLD_DAYS = 7;

/**
 * One asset's rows from every checks file dated on or before as-of, oldest first.
 * The LAST entry is the current checks file's row; it is undefined when the
 * asset is missing from that file. Earlier undefined entries are skipped.
 */
export type ChecksSeries = readonly (ChecksRow | undefined)[];

const FLAG_KEYS = ["auth_required", "auth_revocable", "auth_immutable", "auth_clawback_enabled"] as const satisfies readonly (keyof AssetFlags)[];
type Thresholds = { low: number; medium: number; high: number };

/** "GABC…WXYZ": first 4 and last 4 characters. */
const short = (key: string) => `${key.slice(0, 4)}…${key.slice(-4)}`;

const DAY_MS = 86_400_000;
const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
/** Whole UTC days from one YYYY-MM-DD day to another. */
const wholeDays = (from: string, to: string) => Math.round((dayMs(to) - dayMs(from)) / DAY_MS);
const addDays = (d: string, n: number) => new Date(dayMs(d) + n * DAY_MS).toISOString().slice(0, 10);

type Diff = { changes: string[]; extra?: Record<string, unknown> };

type Kind = {
  flag: "FLAG_CHANGE" | "SIGNER_CHANGE";
  /** For "The previous chain check has no {what}". */
  what: string;
  /** For the clear reasons: "the {subject} …". */
  subject: string;
  /** Start of the raised statement. */
  headline: string;
  joiner: string;
  need: (f: AssetFacts) => boolean;
  diff: (from: AssetFacts, to: AssetFacts) => Diff;
};

const FLAG_CHANGE_KIND: Kind = {
  flag: "FLAG_CHANGE",
  what: "authorization flags",
  subject: "issuer authorization flags",
  headline: "Issuer authorization flags changed",
  joiner: ", ",
  need: (f) => !!f.flags,
  diff: (from, to) => ({ changes: FLAG_KEYS.filter((k) => from.flags![k] !== to.flags![k]).map((k) => `${k} ${from.flags![k]} → ${to.flags![k]}`) }),
};

const SIGNER_CHANGE_KIND: Kind = {
  flag: "SIGNER_CHANGE",
  what: "signers or thresholds",
  subject: "issuer signers and thresholds",
  headline: "Issuer signers or thresholds changed",
  joiner: "; ",
  need: (f) => !!f.issuerSigners && !!f.issuerThresholds,
  diff: (p, c) => {
    const [from, to] = [new Map(p.issuerSigners!.map((s) => [s.key, s.weight])), new Map(c.issuerSigners!.map((s) => [s.key, s.weight]))];
    const changes: string[] = [];
    for (const [key, weight] of to) if (!from.has(key)) changes.push(`added ${short(key)}(weight ${weight})`);
    for (const [key, weight] of from) if (!to.has(key)) changes.push(`removed ${short(key)}(weight ${weight})`);
    for (const [key, weight] of to) if (from.has(key) && from.get(key) !== weight) changes.push(`${short(key)} weight ${from.get(key)} → ${weight}`);
    const [tFrom, tTo]: Thresholds[] = [p.issuerThresholds!, c.issuerThresholds!];
    for (const level of ["low", "medium", "high"] as const) if (tFrom[level] !== tTo[level]) changes.push(`${level} threshold ${tFrom[level]} → ${tTo[level]}`);
    return {
      changes,
      extra: {
        added: [...to].filter(([k]) => !from.has(k)).map(([key, weight]) => ({ key, weight })),
        removed: [...from].filter(([k]) => !to.has(k)).map(([key, weight]) => ({ key, weight })),
        changed: [...to].filter(([k, w]) => from.has(k) && from.get(k) !== w).map(([key, weight]) => ({ key, from: from.get(key), to: weight })),
        thresholds: { from: tFrom, to: tTo },
      },
    };
  },
};

/** A change between two neighbouring usable checks. `seenAt` is the check that first showed it. */
export type ChangeEvent = { from: ChecksRow; to: ChecksRow; seenAt: string; changes: string[]; extra?: Record<string, unknown> };

/** A row the comparison can use: not failed, has the needed facts and a real check time. */
const usable = (kind: Kind, r: ChecksRow | undefined): r is ChecksRow & { facts: AssetFacts } =>
  !!r && !r.error && !!r.facts && kind.need(r.facts) && isIsoDay(day(r.facts.checkedAt));

/**
 * The only event computation: every pair of neighbouring usable rows that differs is one
 * event, oldest first. Unusable rows in the middle are skipped. A revert (A to B, then B to A) is two events.
 */
function changeEvents(kind: Kind, series: ChecksSeries): { rows: (ChecksRow & { facts: AssetFacts })[]; events: ChangeEvent[] } {
  const rows = series.filter((r): r is ChecksRow & { facts: AssetFacts } => usable(kind, r));
  const events: ChangeEvent[] = [];
  for (let i = 1; i < rows.length; i++) {
    const d = kind.diff(rows[i - 1].facts, rows[i].facts);
    if (d.changes.length > 0) events.push({ from: rows[i - 1], to: rows[i], seenAt: rows[i].facts.checkedAt, changes: d.changes, ...(d.extra ? { extra: d.extra } : {}) });
  }
  return { rows, events };
}

function decide(kind: Kind, series: ChecksSeries): Evaluation {
  const { flag } = kind;
  const current = series[series.length - 1];
  if (!current) return notEvaluated(flag, "No chain check for this asset in the current checks file");
  if (current.error || !current.facts) return notEvaluated(flag, "The current chain check failed or has no on-chain facts");
  if (!kind.need(current.facts)) return notEvaluated(flag, `The current chain check has no ${kind.what}`);
  if (!isIsoDay(day(current.facts.checkedAt))) return notEvaluated(flag, "The current chain check has no valid check time");
  const { rows, events } = changeEvents(kind, series);
  if (rows.length < 2) return notEvaluated(flag, "No previous chain check for this asset to compare with");

  const currentDay = day(current.facts.checkedAt);
  const latest = events[events.length - 1];
  if (!latest) {
    return clear(flag, `The ${kind.subject} are the same in all ${rows.length} checks from ${day(rows[0].facts.checkedAt)} to ${currentDay}.`, currentDay, [chainRef(rows[0]), chainRef(current)]);
  }

  const seenDay = day(latest.seenAt);
  const evidence: EvidenceRef[] = [chainRef(latest.from), chainRef(latest.to), ...(latest.to === current ? [] : [chainRef(current)])];
  if (wholeDays(seenDay, currentDay) > CHANGE_HOLD_DAYS) {
    return clear(
      flag,
      `No change in the ${kind.subject} in the ${CHANGE_HOLD_DAYS} days before the check on ${currentDay}; the last change was seen between checks on ${day(latest.from.facts!.checkedAt)} and ${seenDay}.`,
      currentDay,
      evidence,
    );
  }
  const inWindow = events.filter((e) => wholeDays(day(e.seenAt), currentDay) <= CHANGE_HOLD_DAYS).length;
  const statement =
    `${kind.headline} between checks on ${day(latest.from.facts!.checkedAt)} and ${seenDay}: ${latest.changes.join(kind.joiner)}. ` +
    `Held through ${addDays(seenDay, CHANGE_HOLD_DAYS)} (${CHANGE_HOLD_DAYS} days after the change was first seen).` +
    (inWindow > 1 ? ` ${inWindow} changes in the last ${CHANGE_HOLD_DAYS} days.` : "");
  return raised(flag, "WARNING", statement, currentDay, evidence, latest.extra);
}

/** FLAG_CHANGE (WARNING only): the issuer's four authorization flags changed in the last 7 days of checks. */
export const flagFlagChange = (series: ChecksSeries): Evaluation => decide(FLAG_CHANGE_KIND, series);

/** SIGNER_CHANGE (WARNING only): the issuer's signers (key to weight) or thresholds changed in the last 7 days of checks. */
export const flagSignerChange = (series: ChecksSeries): Evaluation => decide(SIGNER_CHANGE_KIND, series);

/**
 * `checkedAt` of the check that first showed the latest FLAG_CHANGE or SIGNER_CHANGE event, or null
 * when none was seen (D-038). Never cleared by the hold window. It does not need the current row to
 * be usable, so a failed current check keeps the earlier change time instead of resetting it.
 * Invariant: whenever either decider is raised, this is non-null and not before that decider's change time.
 */
export function issuerChangeSeenAt(series: ChecksSeries): string | null {
  let latest: string | null = null;
  for (const kind of [FLAG_CHANGE_KIND, SIGNER_CHANGE_KIND]) {
    for (const e of changeEvents(kind, series).events) {
      if (latest === null || Date.parse(e.seenAt) > Date.parse(latest)) latest = e.seenAt;
    }
  }
  return latest;
}
