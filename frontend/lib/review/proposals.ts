/**
 * Proposals file written by the operator in Claude Code (data/review/proposals/<id>.json).
 * It is data, never instructions: every claim still goes through the quote
 * verifier and the claim builder (import.ts). A bad file is refused whole.
 */
import { z } from "zod";
import { extractionSchema, type ProposedClaim } from "../claims/fields";

export const MAX_PROPOSALS_BYTES = 64 * 1024;
export const NOTE_MAX_CHARS = 500;

/** Patterns for secrets that must never be committed. Only the name is ever logged. */
export const SECRET_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "stellar_secret_seed", re: /\bS[A-Z2-7]{55}\b/ },
  { name: "api_key_sk", re: /\bsk-[A-Za-z0-9_-]{16,}/ },
  { name: "api_key_google", re: /\bAIza[0-9A-Za-z_-]{30,}/ },
  { name: "private_key_block", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];

/** The queue entry a file name points to; its id is the file-name stem, which is the review id of that run. */
export type ProposalsExpected = { doc_key: string; codes: string[]; sourceClass: string };

export type ProposalsFile = {
  id: string;
  doc_key: string;
  text_sha256: string;
  proposed_by: string;
  reviewed_at: string;
  note?: string;
  claims: ProposedClaim[];
};

export type ProposalsResult = { ok: true; file: ProposalsFile } | { ok: false; reason: string; text_sha256: string | null };

/** The name of the first secret pattern found in the text, or null. */
export function secretPatternIn(text: string) {
  return SECRET_PATTERNS.find((p) => p.re.test(text))?.name ?? null;
}

function stringsIn(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) stringsIn(v, out);
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) (out.push(k), stringsIn(v, out));
  return out;
}

function schemaFor(codes: string[]) {
  return z
    .object({
      id: z.string().regex(/^[0-9a-f]{16}$/),
      doc_key: z.string().min(1),
      text_sha256: z.string().regex(/^[0-9a-f]{64}$/),
      proposed_by: z.string().regex(/^[\w .:()/,-]{1,80}$/),
      reviewed_at: z.iso.datetime(),
      note: z.string().max(NOTE_MAX_CHARS).optional(),
      claims: z.array(extractionSchema(codes as [string, ...string[]]).shape.claims.element.strict()),
    })
    .strict()
    .refine((f) => f.claims.length > 0 ? true : !!f.note?.trim(), { message: "note is required when claims is empty", path: ["note"] });
}

/**
 * Validate one proposals file. `expected` is the queue entry the file name points
 * to (null if there is none). The reason never contains the offending text.
 */
export function validateProposals(input: { stem: string; raw: string; /** Raw size of the file in bytes (default: the UTF-8 size of `raw`). */ bytes?: number; expected: ProposalsExpected | null; now: string }): ProposalsResult {
  const refuse = (reason: string, text_sha256: string | null = null): ProposalsResult => ({ ok: false, reason: reason.slice(0, 300), text_sha256 });
  const { stem, raw, expected } = input;
  if ((input.bytes ?? Buffer.byteLength(raw)) > MAX_PROPOSALS_BYTES) return refuse(`file is larger than ${MAX_PROPOSALS_BYTES / 1024} KB`);
  const secretRaw = secretPatternIn(raw);
  if (secretRaw) return refuse(`contains a secret-like string (pattern ${secretRaw}); delete the file and do not commit it`);
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return refuse("not valid JSON");
  }
  // Escaped forms (\uXXXX) only show up after parsing.
  const secret = stringsIn(json).map(secretPatternIn).find(Boolean);
  if (secret) return refuse(`contains a secret-like string (pattern ${secret}); delete the file and do not commit it`);

  if (!/^[0-9a-f]{16}$/.test(stem)) return refuse("file name must be <id>.json with a 16-hex id");
  if (!expected) return refuse("not_in_queue");
  if (expected.sourceClass !== "issuer" && expected.sourceClass !== "issuer_toml") return refuse(`source class ${expected.sourceClass} is not reviewable`);
  const parsed = schemaFor(expected.codes).safeParse(json);
  if (!parsed.success) return refuse(`schema: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
  const file = parsed.data as ProposalsFile;
  if (file.id !== stem) return refuse("id does not match the file name", file.text_sha256);
  if (Date.parse(file.reviewed_at) > Date.parse(input.now)) return refuse("reviewed_at is in the future", file.text_sha256);
  if (file.doc_key !== expected.doc_key) return refuse("doc_key does not match the queue entry", file.text_sha256);
  return { ok: true, file };
}
