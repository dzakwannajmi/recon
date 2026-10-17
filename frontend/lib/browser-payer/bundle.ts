/**
 * What the page shows of a paid `check-detail/1` bundle (spec W4.7). A fixed projection of the fields we know,
 * with every string cut and its invisible characters escaped. Issuer quotes and source URLs are untrusted
 * text: they are returned as plain strings for text rendering only, never as links or markup, and the bundle
 * is never sent to the model.
 */
import { escapeInvisible } from "../gateway/text";
import { DETAIL_SCHEMA } from "./constants";

const MAX_TEXT = 1000;
const MAX_ITEMS = 25;

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v.slice(0, MAX_ITEMS) : []);

/** A string, cut to 1000 characters with invisible characters escaped; anything else is null. */
export function safeText(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v !== "string") return null;
  const cut = Array.from(v).slice(0, MAX_TEXT).join("");
  return escapeInvisible(cut);
}

export type EvidenceView = { quote: string | null; source_url: string | null; snapshot_sha256: string | null; where: string | null };
export type FlagView = { flag: string | null; outcome: string | null; severity: string | null; text: string | null; as_of: string | null; evidence: EvidenceView[] };
export type ClaimView = { field: string | null; value_text: string | null; quote: string | null; source_url: string | null; source_class: string | null; page: string | null; snapshot_sha256: string | null };
export type BundleView = {
  asset: { code: string | null; issuer: string | null; issuer_org: string | null };
  status: { value: string | null; as_of: string | null };
  flags: FlagView[];
  claims: ClaimView[];
  feed: { read: string | null; matches: boolean | null };
  evidence_hash: string | null;
  generated_at: string | null;
};

/** The view of a bundle, or null when the body is not a `check-detail/1` object. */
export function toBundleView(body: unknown): BundleView | null {
  if (!isObj(body) || body.schema !== DETAIL_SCHEMA) return null;
  const asset = isObj(body.asset) ? body.asset : {};
  const status = isObj(body.status) ? body.status : {};
  const claims = isObj(body.claims) ? body.claims : {};
  const feed = isObj(body.feed) ? body.feed : {};
  const onchain = isObj(feed.onchain) ? feed.onchain : {};
  const evidence = isObj(body.evidence) ? body.evidence : {};
  return {
    asset: { code: safeText(asset.code), issuer: safeText(asset.issuer), issuer_org: safeText(asset.issuer_org) },
    status: { value: safeText(status.value), as_of: safeText(status.as_of) },
    flags: list(body.flags)
      .filter(isObj)
      // Clear and not-evaluated flags are not listed; the raised ones carry the statement and evidence.
      .filter((f) => f.outcome === "raised")
      .map((f) => ({
        flag: safeText(f.flag),
        outcome: safeText(f.outcome),
        severity: safeText(f.effective_severity ?? f.severity),
        text: safeText(f.text),
        as_of: safeText(f.as_of),
        evidence: list(f.evidence)
          .filter(isObj)
          .map((e) => ({ quote: safeText(e.quote), source_url: safeText(e.source_url), snapshot_sha256: safeText(e.snapshot_sha256), where: safeText(e.where) })),
      })),
    claims: list(claims.items)
      .filter(isObj)
      .map((c) => ({
        field: safeText(c.field),
        value_text: safeText(c.value_text),
        quote: safeText(c.quote),
        source_url: safeText(c.source_url),
        source_class: safeText(c.source_class),
        page: safeText(c.page),
        snapshot_sha256: safeText(c.snapshot_sha256),
      })),
    feed: { read: safeText(onchain.read), matches: typeof onchain.matches === "boolean" ? onchain.matches : null },
    evidence_hash: safeText(evidence.evidence_hash),
    generated_at: safeText(body.generated_at),
  };
}
