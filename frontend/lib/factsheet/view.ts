/**
 * Pure helpers for the fact sheet pages. No React, no network. Everything that
 * came from the data (statements, reasons, quotes, URLs) is passed through
 * verbatim; this file only decides how to show it.
 */
import { isIsoDay, type EvidenceRef } from "../flags/types";
import type { LoadedAsset, StatusFile } from "./load";

/** The URL if it parses and is http(s); otherwise null (shown as plain text, never as a link). */
export function safeHttpUrl(s: string | null | undefined): string | null {
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    // Credentials in a URL are a phishing trick (https://good.example@evil.example); show it as text instead.
    return u.username || u.password ? null : u.href;
  } catch {
    return null;
  }
}

/** Replaces {name} with vars[name]; unknown placeholders stay as written. */
export function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (Object.hasOwn(vars, k) ? String(vars[k]) : m));
}

/** The one asset with this exact code; null if there is none or more than one (ambiguous). */
export function findAsset(status: Pick<StatusFile, "assets">, code: string): LoadedAsset | null {
  const hits = status.assets.filter((a) => a.asset_code === code);
  return hits.length === 1 ? hits[0] : null;
}

export type EvidenceView =
  | { kind: "chain_check"; date: string }
  | { kind: "examination"; date: string; check: string }
  | { kind: "link"; url: string | null; rawUrl: string; label: string }
  | { kind: "document"; url: string | null; rawUrl: string | null; quote: string | null; where: string | null; snapshot_sha256: string | null }
  | { kind: "other"; ref: string };

const CHAIN_REF = /^data\/checks\/(\d{4}-\d{2}-\d{2})\.json#/;
const EXAM_REF = /^data\/examinations\/(\d{4}-\d{2}-\d{2})\.json#([^#]*)#([^#]+)$/;

/** How to render one evidence reference. Never throws. */
export function evidenceView(ref: EvidenceRef): EvidenceView {
  try {
    const raw = typeof ref.ref === "string" ? ref.ref : String(ref.ref);
    switch (ref.kind) {
      case "chain_check": {
        if (ref.source_url) {
          const url = safeHttpUrl(ref.source_url);
          return { kind: "link", url, rawUrl: ref.source_url, label: url ? new URL(url).hostname : ref.source_url };
        }
        const m = CHAIN_REF.exec(raw);
        return m && isIsoDay(m[1]) ? { kind: "chain_check", date: m[1] } : { kind: "other", ref: raw };
      }
      case "examination": {
        const m = EXAM_REF.exec(raw);
        return m && isIsoDay(m[1]) ? { kind: "examination", date: m[1], check: m[3] } : { kind: "other", ref: raw };
      }
      case "source_fact":
      case "claim":
      case "snapshot":
        return {
          kind: "document",
          url: safeHttpUrl(ref.source_url),
          rawUrl: ref.source_url ?? null,
          quote: ref.quote ?? null,
          where: ref.where ?? null,
          snapshot_sha256: ref.snapshot_sha256 ?? null,
        };
      default:
        return { kind: "other", ref: raw };
    }
  } catch {
    return { kind: "other", ref: String((ref as { ref?: unknown })?.ref ?? "") };
  }
}

const ISSUER_RE = /^G[A-Z2-7]{55}$/;
const CODE_RE = /^[A-Za-z0-9]{1,12}$/;

/** Horizon and StellarExpert links, only when the issuer and code are well formed; otherwise null. */
export function explorerLinks(code: string, issuer: string): { horizon: string; explorer: string } | null {
  if (!ISSUER_RE.test(issuer) || !CODE_RE.test(code)) return null;
  return {
    horizon: `https://horizon.stellar.org/accounts/${issuer}`,
    explorer: `https://stellar.expert/explorer/public/asset/${code}-${issuer}`,
  };
}

/** The feed bitmask as a 9-bit binary string (bit 8 first). */
export const bitmaskBinary = (mask: number, bits = 9) => (mask >>> 0).toString(2).padStart(bits, "0").slice(-bits);

/** Counts shown in the status summary sentence. */
export function counts(a: LoadedAsset) {
  return { raised: a.raised.length, clear: a.clear.length, not_evaluated: a.not_evaluated.length };
}

/** Date part of an evidence/checks timestamp, for "checks file date". */
export const dayOf = (iso: string) => iso.slice(0, 10);

/** The checks-file date of an input path like data/checks/2026-10-08.json; null if it doesn't match. */
export function inputDate(p: string | undefined | null): string | null {
  const m = p ? /(\d{4}-\d{2}-\d{2})\.json$/.exec(p) : null;
  return m && isIsoDay(m[1]) ? m[1] : null;
}

/** An ISO timestamp as `YYYY-MM-DD HH:mm` (UTC, no `Z`); anything that isn't one is returned unchanged. */
export function formatTimestamp(iso: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|\+00:00)$/.exec(iso);
  return m && isIsoDay(m[1]) ? `${m[1]} ${m[2]}` : iso;
}
