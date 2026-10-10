/**
 * Text helpers shared by the check routes and the MCP endpoint. Pure: no I/O.
 */

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

/** Replaces each invisible or direction-changing character with its JSON unicode escape. */
export function escapeInvisible(text: string): string {
  return text.replace(INVISIBLE, escapeCodePoint);
}

/** The first `max` code points; `truncated` says whether anything was cut (never splits a surrogate pair). */
export function cutCodePoints(text: string, max: number): { text: string; truncated: boolean } {
  const chars = Array.from(text);
  return chars.length <= max ? { text, truncated: false } : { text: chars.slice(0, max).join(""), truncated: true };
}
