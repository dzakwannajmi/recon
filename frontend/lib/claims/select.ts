/**
 * Choose which parts of a document go to the LLM, deterministically, so a
 * long prospectus fits the daily token budget (golden rule 11). PDF pages
 * and HTML/text chunks are scored by claim keywords; the best ones are sent
 * in document order, each labeled with its page.
 */
import { PAGE_BREAK } from "../documents/extract";

export const MAX_CHARS_PER_DOCUMENT = 24_000;
const CHUNK_CHARS = 3_000;

const KEYWORDS = [
  /net assets?|assets under management|\baum\b|total assets/gi,
  /net asset value|\bnav\b|price per (share|token|unit)/gi,
  /(shares|tokens|units|certificates) outstanding|outstanding (shares|tokens|units)|total supply|circulating/gi,
  /\b(1|one) [A-Za-z0-9]{2,12} (token )?(represents|corresponds|equals|is equal)/gi,
  /\bstellar\b|blockchain|network|ethereum|polygon|solana|arbitrum|avalanche|base\b/gi,
  /attestation|audit(or|ed)?|financial statements?|report(ed)? as of|as of [A-Z][a-z]+ \d/gi,
  /custodian|custody|trustee|depositary|administrator/gi,
  /verwahr|nettoinventarwert|ausgegeben|emissionsvolumen/gi,
];

export type Chunk = { label: string; text: string; score: number; order: number };

export function chunkDocument(text: string, kind: "pdf" | "html" | "xml" | "text"): Chunk[] {
  if (kind === "pdf") {
    return text.split(PAGE_BREAK).map((page, i) => ({ label: `page ${i + 1}`, text: page.trim(), score: 0, order: i }));
  }
  const chunks: Chunk[] = [];
  let current = "";
  for (const line of text.split("\n")) {
    if (current.length + line.length > CHUNK_CHARS && current) {
      chunks.push({ label: `part ${chunks.length + 1}`, text: current.trim(), score: 0, order: chunks.length });
      current = "";
    }
    current += `${line.slice(0, CHUNK_CHARS)}\n`;
  }
  if (current.trim()) chunks.push({ label: `part ${chunks.length + 1}`, text: current.trim(), score: 0, order: chunks.length });
  return chunks;
}

export function scoreChunk(text: string, extraTerms: string[] = []) {
  let score = 0;
  for (const re of KEYWORDS) score += Math.min(5, (text.match(re) ?? []).length);
  for (const term of extraTerms) if (term.length >= 3 && text.toLowerCase().includes(term.toLowerCase())) score += 2;
  return score;
}

/** The highest-scoring chunks (score > 0) that fit the budget, returned in document order. */
export function selectChunks(text: string, kind: "pdf" | "html" | "xml" | "text", extraTerms: string[] = [], maxChars = MAX_CHARS_PER_DOCUMENT) {
  const chunks = chunkDocument(text, kind)
    .filter((c) => c.text.length > 0)
    .map((c) => ({ ...c, score: scoreChunk(c.text, extraTerms) }));
  const ranked = chunks.filter((c) => c.score > 0).sort((a, b) => b.score - a.score || a.order - b.order);
  const picked: Chunk[] = [];
  let used = 0;
  for (const c of ranked) {
    const text = c.text.slice(0, maxChars);
    if (used + text.length > maxChars) continue;
    picked.push({ ...c, text });
    used += text.length;
  }
  return { chunks: picked.sort((a, b) => a.order - b.order), totalChunks: chunks.length, chars: used };
}
