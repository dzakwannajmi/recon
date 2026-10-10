/**
 * The flag catalog with counts and every raised flag (`flag-list/1`, spec 4.4).
 * Pure projection of the stored status file: counts are tallies of stored outcomes, and `status_counts`
 * is the file's own `summary`, copied as stored. Nothing is recomputed (golden rule 1).
 */
import { factSheetPath } from "../agent-data/assets";
import { COPY } from "../factsheet/copy";
import type { StatusFile } from "../factsheet/load";
import { FLAG_BITS, FLAG_ORDER, type FlagName, type Severity } from "../flags/types";
import { NOTICE, SCOPE_NOTE } from "../gateway/copy";
import { MAX_RAISED_ITEMS } from "./limits";
import { FLAG_LIST_SCHEMA, type FlagListOutput } from "./schemas";

export type FlagListInput = {
  status: { file: string; status: StatusFile };
  filters: { flag?: FlagName | undefined; severity?: Severity | undefined };
};

export function buildFlagList({ status, filters }: FlagListInput): FlagListOutput {
  const file = status.status;
  const copy = COPY.en;

  const perFlag = new Map<FlagName, { raised: number; clear: number; not_evaluated: number }>();
  for (const flag of FLAG_ORDER) perFlag.set(flag, { raised: 0, clear: 0, not_evaluated: 0 });
  for (const a of file.assets) {
    for (const f of a.raised) (perFlag.get(f.flag) as { raised: number }).raised++;
    for (const f of a.clear) (perFlag.get(f.flag) as { clear: number }).clear++;
    for (const f of a.not_evaluated) (perFlag.get(f.flag) as { not_evaluated: number }).not_evaluated++;
  }

  const codeCount = new Map<string, number>();
  for (const a of file.assets) codeCount.set(a.asset_code, (codeCount.get(a.asset_code) ?? 0) + 1);

  const items: FlagListOutput["raised"]["items"] = [];
  for (const a of file.assets) {
    for (const flag of FLAG_ORDER) {
      if (filters.flag !== undefined && filters.flag !== flag) continue;
      const f = a.raised.find((r) => r.flag === flag);
      if (!f) continue;
      if (filters.severity !== undefined && f.effective_severity !== filters.severity) continue;
      items.push({
        asset_code: a.asset_code,
        issuer: a.issuer,
        issuer_org: a.issuer_org,
        asset_status: a.status,
        flag,
        bit: FLAG_BITS[flag],
        severity: f.severity,
        effective_severity: f.effective_severity,
        review: f.review,
        statement: f.statement,
        as_of: f.as_of,
        fact_sheet: codeCount.get(a.asset_code) === 1 ? factSheetPath(a.asset_code) : null,
      });
    }
  }
  const returned = items.slice(0, MAX_RAISED_ITEMS);

  return {
    schema: FLAG_LIST_SCHEMA,
    as_of: file.as_of,
    rules_version: file.rules_version,
    source_file: `data/status/${status.file}`,
    filters: { flag: filters.flag ?? null, severity: filters.severity ?? null },
    status_counts: { ...file.summary },
    flags: FLAG_ORDER.map((flag) => ({
      flag,
      bit: FLAG_BITS[flag],
      name: copy.flags[flag].name,
      checks: copy.flags[flag].checks,
      ...(perFlag.get(flag) as { raised: number; clear: number; not_evaluated: number }),
    })),
    raised: { total: items.length, returned: returned.length, truncated: items.length > returned.length, items: returned },
    scope: SCOPE_NOTE,
    notice: NOTICE,
  };
}
