/**
 * JSON responses for the check routes (spec 6.3). The parsed value is identical to the input
 * (quotes stay verbatim), but invisible and direction-changing characters never travel as raw
 * bytes: they leave as JSON unicode escapes (astral ones as surrogate pairs). Output is JSON only, never HTML.
 */
import { NextResponse } from "next/server";

/**
 * Code point ranges that are escaped:
 * - U+2028, U+2029 (line separators), U+FEFF (byte order mark), U+00AD (soft hyphen);
 * - bidi controls: U+061C, U+200E, U+200F, U+202A to U+202E, U+2066 to U+2069;
 * - zero-width and invisible operators: U+200B to U+200D, U+2060 to U+2064;
 * - the tag characters U+E0000 to U+E007F.
 * Written as numbers so no invisible character sits in this source file.
 */
const ESCAPED_RANGES: readonly (readonly [number, number])[] = [
  [0x00ad, 0x00ad],
  [0x061c, 0x061c],
  [0x200b, 0x200f],
  [0x2028, 0x2029],
  [0x202a, 0x202e],
  [0x2060, 0x2064],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff],
  [0xe0000, 0xe007f],
];

const BACKSLASH = String.fromCharCode(0x5c);
const hex = (n: number) => n.toString(16).padStart(4, "0");

const INVISIBLE = new RegExp(`[${ESCAPED_RANGES.map(([a, b]) => `${BACKSLASH}u{${a.toString(16)}}-${BACKSLASH}u{${b.toString(16)}}`).join("")}]`, "gu");

/** One code point as JSON escapes: a single escape for the BMP, a surrogate pair above it. */
function escapeCodePoint(ch: string): string {
  const cp = ch.codePointAt(0) as number;
  if (cp <= 0xffff) return `${BACKSLASH}u${hex(cp)}`;
  const v = cp - 0x10000;
  return `${BACKSLASH}u${hex(0xd800 + (v >> 10))}${BACKSLASH}u${hex(0xdc00 + (v & 0x3ff))}`;
}

/** `JSON.stringify` with bigint values as numbers (when safe) or strings, and the characters above escaped. */
export function toJsonText(body: unknown): string {
  const text = JSON.stringify(body, (_key, value: unknown) => {
    if (typeof value !== "bigint") return value;
    return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= -BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString();
  });
  return text.replace(INVISIBLE, escapeCodePoint);
}

export function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): NextResponse {
  return jsonTextResponse(toJsonText(body), init);
}

/** A response from text that `toJsonText` already produced. */
export function jsonTextResponse(text: string, init: { status?: number; headers?: Record<string, string> } = {}): NextResponse {
  return new NextResponse(text, {
    status: init.status ?? 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      ...init.headers,
    },
  });
}
