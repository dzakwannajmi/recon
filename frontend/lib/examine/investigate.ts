/**
 * Bounded investigation of a supply mismatch (deterministic, read-only).
 * Each step records the query it made and what it found; the conclusion
 * only states facts and the limits of the data, never intent (golden rule 4).
 *
 * Steps:
 * 1. Where the supply sits (Horizon balance components).
 * 2. Issuance history: payments from the issuer (mints) and to it (burns),
 *    with the date range the history covers.
 * 3. Other supply-changing operations by the issuer (clawbacks, claimable
 *    balances, path payments) in the same window.
 */
import { formatStroops, toStroops } from "../chain/asset";
import { fetchTrustedJson } from "../chain/http";
import { HORIZON_MAINNET } from "../chain/horizon";

const MAX_PAGES = 10;
const PAGE_SIZE = 200;

export type InvestigationStep = { step: string; query: string | null; finding: string; data?: unknown };
export type Investigation = { asset: string; check: string; started_at: string; steps: InvestigationStep[]; conclusion: string; limits: string[] };

type Op = {
  type: string;
  created_at: string;
  transaction_hash: string;
  from?: string;
  to?: string;
  amount?: string;
  asset_code?: string;
  asset_issuer?: string;
  source_account?: string;
};
type Page = { _embedded: { records: Op[] }; _links?: { next?: { href: string } } };

/** Read up to MAX_PAGES pages of an issuer's operations or payments, oldest first. */
async function readAll(path: "payments" | "operations", issuer: string, signal?: AbortSignal) {
  const records: Op[] = [];
  let url: string | undefined = `${HORIZON_MAINNET}/accounts/${encodeURIComponent(issuer)}/${path}?order=asc&limit=${PAGE_SIZE}`;
  const first = url;
  let pages = 0;
  while (url && pages < MAX_PAGES) {
    const page: Page = await fetchTrustedJson<Page>(url, { signal });
    records.push(...page._embedded.records);
    pages++;
    const next = page._links?.next?.href;
    url = page._embedded.records.length === PAGE_SIZE && next && new URL(next).origin === HORIZON_MAINNET ? next : undefined;
  }
  return { records, truncated: url !== undefined, query: first };
}

export async function investigateSupplyMismatch(input: {
  asset: string; // CODE:ISSUER
  check: string;
  supply: string;
  breakdown: Record<string, string> | undefined;
  reference: { label: string; value: number };
  signal?: AbortSignal;
  now?: string;
}): Promise<Investigation> {
  const [code, issuer] = input.asset.split(":");
  const steps: InvestigationStep[] = [];
  const limits: string[] = [];
  const isAsset = (op: Op) => op.asset_code === code && op.asset_issuer === issuer;

  // 1. Where the supply sits.
  const nonZero = Object.entries(input.breakdown ?? {}).filter(([, v]) => !/^0(\.0+)?$/.test(v));
  steps.push({
    step: "supply_breakdown",
    query: `${HORIZON_MAINNET}/assets?asset_code=${code}&asset_issuer=${issuer}`,
    finding: nonZero.length ? `Supply ${input.supply} is held as: ${nonZero.map(([k, v]) => `${k} ${v}`).join(", ")}.` : `Supply ${input.supply}; no breakdown available.`,
    data: input.breakdown,
  });

  // 2. Issuance history.
  const payments = await readAll("payments", issuer, input.signal);
  let minted = 0n;
  let burned = 0n;
  let mints = 0;
  let burns = 0;
  let firstOver: Op | null = null;
  const threshold = BigInt(input.reference.value) * 10_000_000n;
  for (const op of payments.records) {
    if (!isAsset(op) || !op.amount) continue;
    if (op.from === issuer) {
      minted += toStroops(op.amount);
      mints++;
    } else if (op.to === issuer) {
      burned += toStroops(op.amount);
      burns++;
    }
    if (!firstOver && minted - burned > threshold) firstOver = op;
  }
  const from = payments.records[0]?.created_at ?? null;
  const to = payments.records.at(-1)?.created_at ?? null;
  if (payments.truncated) limits.push(`Issuer payments were read up to ${MAX_PAGES * PAGE_SIZE} records; later history was not read.`);
  steps.push({
    step: "issuance_history",
    query: payments.query,
    finding:
      `${payments.records.length} issuer payments${from ? ` from ${from.slice(0, 10)} to ${to!.slice(0, 10)}` : ""}: ` +
      `${mints} payments of ${code} from the issuer (${formatStroops(minted)}) and ${burns} back to it (${formatStroops(burned)}).` +
      (firstOver ? ` Net issuance first exceeded ${input.reference.value} on ${firstOver.created_at.slice(0, 10)} (tx ${firstOver.transaction_hash}).` : ""),
    data: { records: payments.records.length, from, to, mints, burns, minted: formatStroops(minted), burned: formatStroops(burned) },
  });

  // 3. Other supply-changing operations by the issuer.
  const operations = await readAll("operations", issuer, input.signal);
  const firstOp = operations.records[0];
  const createdInWindow = firstOp?.type === "create_account";
  const relevant = ["clawback", "clawback_claimable_balance", "create_claimable_balance", "path_payment_strict_send", "path_payment_strict_receive", "liquidity_pool_deposit"];
  const counts: Record<string, number> = {};
  for (const op of operations.records) if (relevant.includes(op.type)) counts[op.type] = (counts[op.type] ?? 0) + 1;
  if (!createdInWindow) {
    limits.push(
      `Horizon's history for the issuer starts at ${firstOp?.created_at.slice(0, 10) ?? "an unknown date"} and does not include the account's creation, so earlier issuance is not visible here.`,
    );
  }
  if (operations.truncated) limits.push(`Issuer operations were read up to ${MAX_PAGES * PAGE_SIZE} records.`);
  steps.push({
    step: "other_supply_operations",
    query: operations.query,
    finding: Object.keys(counts).length
      ? `Other operations that can change where or how much ${code} exists: ${Object.entries(counts).map(([t, n]) => `${t} ×${n}`).join(", ")}.`
      : `No clawback, claimable-balance, path-payment, or pool-deposit operations by the issuer in the history read.`,
    data: { first_operation: firstOp?.type ?? null, first_operation_at: firstOp?.created_at ?? null, counts },
  });

  const conclusion =
    `On-chain supply ${input.supply} differs from ${input.reference.label} (${input.reference.value}). ` +
    (mints > 0
      ? `The issuer's payment history read here shows ${mints} issuance payment(s) of ${code} and ${burns} payment(s) back to the issuer.`
      : `The issuer's payment history read here (from ${from?.slice(0, 10) ?? "an unknown date"}) shows no issuance payment of ${code}${burns ? ` and ${burns} payment(s) back to the issuer` : ""}; the tokens were issued before that history or by other operations.`);
  return { asset: input.asset, check: input.check, started_at: input.now ?? new Date().toISOString(), steps, conclusion, limits };
}

/** Share of a document's non-empty, non-comment lines that also appear in a reference document. */
export function lineOverlap(text: string, reference: string) {
  const lines = (t: string) => new Set(t.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#")));
  const mine = lines(text);
  const theirs = lines(reference);
  if (mine.size === 0) return 0;
  let same = 0;
  for (const l of mine) if (theirs.has(l)) same++;
  return same / mine.size;
}

/**
 * Bounded investigation of an issuer that does not verify against the
 * official domain pinned for its asset code (e.g. a lookalike domain).
 * Facts only: who funded the account and when, its footprint, and how its
 * stellar.toml compares with the official one. Never a judgement of intent.
 */
export async function investigateIdentityMismatch(input: {
  code: string;
  issuer: string;
  status: string;
  homeDomain: string | null;
  officialDomains: string[];
  trustlines: number;
  supply: string | null;
  toml: { url: string; text: string; sha256: string } | null;
  officialToml: { url: string; text: string; sha256: string } | null;
  signal?: AbortSignal;
  now?: string;
}): Promise<Investigation> {
  const steps: InvestigationStep[] = [];
  const limits: string[] = [];
  const asset = `${input.code}:${input.issuer}`;

  steps.push({
    step: "identity",
    query: `${HORIZON_MAINNET}/accounts/${input.issuer}`,
    finding: `home_domain ${input.homeDomain ?? "(none)"}; the official domain pinned for ${input.code} is ${input.officialDomains.join(" or ")}; identity status ${input.status}.`,
  });

  const opsUrl = `${HORIZON_MAINNET}/accounts/${encodeURIComponent(input.issuer)}/operations?order=asc&limit=1`;
  const first = (await fetchTrustedJson<Page>(opsUrl, { signal: input.signal }))._embedded.records[0] as (Op & { funder?: string; account?: string }) | undefined;
  if (first?.type === "create_account") {
    steps.push({ step: "account_origin", query: opsUrl, finding: `Account created on ${first.created_at.slice(0, 10)} by ${first.funder} (tx ${first.transaction_hash}).`, data: { funder: first.funder, created_at: first.created_at } });
  } else {
    steps.push({ step: "account_origin", query: opsUrl, finding: `The earliest operation in Horizon's history is ${first?.type ?? "unknown"} on ${first?.created_at.slice(0, 10) ?? "an unknown date"}.` });
    limits.push("Horizon's history does not include this account's creation.");
  }

  steps.push({
    step: "footprint",
    query: `${HORIZON_MAINNET}/assets?asset_code=${input.code}&asset_issuer=${input.issuer}`,
    finding: `${input.trustlines} authorized trustlines; supply ${input.supply ?? "unknown"}.`,
  });

  if (input.toml) {
    const overlap = input.officialToml ? lineOverlap(input.toml.text, input.officialToml.text) : null;
    const orgName = /ORG_NAME\s*=\s*"([^"]*)"/.exec(input.toml.text)?.[1] ?? null;
    const officialOrg = input.officialToml ? /ORG_NAME\s*=\s*"([^"]*)"/.exec(input.officialToml.text)?.[1] ?? null : null;
    steps.push({
      step: "toml_comparison",
      query: input.toml.url,
      finding:
        `stellar.toml at ${input.homeDomain} (sha256 ${input.toml.sha256.slice(0, 12)}…)` +
        (orgName ? ` states ORG_NAME "${orgName}"${officialOrg ? (orgName === officialOrg ? `, the same as the official toml` : `; the official toml states "${officialOrg}"`) : ""}` : " states no ORG_NAME") +
        (overlap !== null ? `; ${Math.round(overlap * 100)}% of its lines also appear in the official toml (${input.officialToml!.url}).` : "."),
      data: { org_name: orgName, official_org_name: officialOrg, line_overlap: overlap },
    });
  } else {
    steps.push({ step: "toml_comparison", query: null, finding: `No stellar.toml could be read at ${input.homeDomain ?? "(no home_domain)"}.` });
  }

  const conclusion =
    `Issuer ${input.issuer} uses the code ${input.code} with home_domain ${input.homeDomain ?? "(none)"}, which is not the official domain pinned for ${input.code} (${input.officialDomains.join(" or ")}). ` +
    steps.filter((s) => s.step !== "identity").map((s) => s.finding).join(" ");
  return { asset, check: `issuer_identity:${input.status}`, started_at: input.now ?? new Date().toISOString(), steps, conclusion, limits };
}
