/**
 * JSON responses for the check routes (spec 6.3). The parsed value is identical to the input
 * (quotes stay verbatim), but invisible and direction-changing characters never travel as raw
 * bytes: they leave as JSON unicode escapes. Output is JSON only, never HTML.
 */
import { NextResponse } from "next/server";

/**
 * Code point ranges that are escaped: U+2028 and U+2029 (line separators), U+200E and U+200F,
 * U+202A to U+202E, U+2066 to U+2069 (bidi controls), and U+FEFF (byte order mark).
 * Written as numbers so no invisible character sits in this source file.
 */
const ESCAPED_RANGES: readonly (readonly [number, number])[] = [
  [0x2028, 0x2029],
  [0x200e, 0x200f],
  [0x202a, 0x202e],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff],
];

const INVISIBLE = new RegExp(
  `[${ESCAPED_RANGES.map(([a, b]) => `${String.fromCharCode(0x5c)}u${a.toString(16).padStart(4, "0")}-${String.fromCharCode(0x5c)}u${b.toString(16).padStart(4, "0")}`).join("")}]`,
  "g",
);

/** `JSON.stringify` with bigint values as numbers (when safe) or strings, and the characters above escaped. */
export function toJsonText(body: unknown): string {
  const text = JSON.stringify(body, (_key, value: unknown) => {
    if (typeof value !== "bigint") return value;
    return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= -BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString();
  });
  return text.replace(INVISIBLE, (ch) => `${String.fromCharCode(0x5c)}u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`);
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
