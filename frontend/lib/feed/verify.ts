/**
 * Verify what the feed holds against a status file (spec 3.4, steps 1 to 3):
 * read every key, then compare version, status, flags, evidence hash, `as_of`, and change time.
 * Read only: simulation, no signing. Node runtime only (golden rule 1).
 */
import { FEED_SCHEMA } from "../flags/types";
import type { Deployment } from "./deployment";
import type { FeedReader, Roles } from "./reader";
import { entryMatches, fileFieldsOf, toUpdate, type Entry, type StatusFile, type Update } from "./encode";

export type VerifyRow = {
  code: string;
  asset: string;
  status: string;
  flags: number;
  as_of: string;
  ledger: number | null;
  ok: boolean;
  diffs: string[];
};

const assetCode = (asset: string) => asset.split(":")[0];

/** Entry versus file for each published asset (status not null). Assets with `status: null` are not in the feed. */
export async function verifyFile(file: StatusFile, client: Pick<FeedReader, "readEntries">): Promise<VerifyRow[]> {
  const fields = fileFieldsOf(file);
  const rows: VerifyRow[] = [];
  const expected: { asset: string; update: Update }[] = [];
  for (const a of file.assets) {
    if (a.status === null) continue;
    try {
      expected.push({ asset: a.asset, update: toUpdate(fields, a) });
    } catch (err) {
      // The file itself does not recompute: that is a mismatch, not something to skip.
      rows.push({ code: assetCode(a.asset), asset: a.asset, status: a.status, flags: a.flags_bitmask, as_of: a.checked_at ?? "-", ledger: null, ok: false, diffs: [err instanceof Error ? err.message : String(err)] });
    }
  }
  const entries: (Entry | null)[] = await client.readEntries(expected.map((e) => e.update.asset));
  expected.forEach(({ asset, update }, i) => {
    const entry = entries[i];
    const a = file.assets.find((x) => x.asset === asset)!;
    const diffs = entry ? entryMatches(entry, update) : ["no entry in the feed"];
    rows.push({
      code: assetCode(asset), asset, status: a.status as string, flags: update.flags, as_of: a.checked_at as string,
      ledger: entry ? entry.published_ledger : null, ok: diffs.length === 0, diffs,
    });
  });
  return rows;
}

/** The contract's roles and schema against deployment.json and this code; any difference is a row that fails. */
export function verifyRoles(roles: Roles, deployment: Deployment, fileSchema: number): VerifyRow[] {
  const row = (code: string, onChain: string, expected: string): VerifyRow => ({
    code, asset: code, status: "-", flags: 0, as_of: "-", ledger: null, ok: onChain === expected,
    diffs: onChain === expected ? [] : [`${code}() is ${onChain}, expected ${expected}`],
  });
  return [
    row("schema", String(roles.schema), String(FEED_SCHEMA)),
    row("file_schema", String(fileSchema), String(roles.schema)),
    row("publisher", roles.publisher, deployment.publisher),
    row("admin", roles.admin, deployment.admin),
  ];
}

/** A compact fixed-width table, one line per asset, then the totals. */
export function formatVerifyTable(rows: readonly VerifyRow[]): string {
  const header = ["ASSET", "STATUS", "FLAGS", "AS_OF", "LEDGER", "RESULT"];
  const body = rows.map((r) => [r.code, r.status, String(r.flags), r.as_of, r.ledger === null ? "-" : String(r.ledger), r.ok ? "match" : "MISMATCH"]);
  const widths = header.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join("  ").trimEnd();
  const lines = [line(header), ...body.map(line)];
  for (const r of rows.filter((x) => !x.ok)) lines.push(`  ${r.code}: ${r.diffs.join("; ")}`);
  const bad = rows.filter((r) => !r.ok).length;
  lines.push(`${rows.length} checked, ${rows.length - bad} match, ${bad} mismatch`);
  return lines.join("\n");
}
