/**
 * Text helpers shared by the check routes, the MCP endpoint, and the chat path. Pure: no I/O.
 */

/**
 * Characters that are escaped (threat model A5), chosen by Unicode property so a newly assigned invisible
 * character is covered without a list update:
 * - \p{Cf} (format: zero-width, bidi controls, soft hyphen, byte order mark, tag characters),
 *   \p{Zl} and \p{Zp} (line and paragraph separators), and \p{Cc} (controls, C1 included), except
 *   U+0009, U+000A, U+000D, which are SSE framing and JSON whitespace;
 * - U+E0000 to U+E007F (the whole tag block, as in the first version, although some of it is unassigned);
 * - invisible characters outside those categories: U+034F, U+115F, U+1160, U+17B4, U+17B5, U+3164,
 *   U+FFA0, the variation selectors U+FE00 to U+FE0F, and U+E0100 to U+E01EF.
 * None of these can sit outside a JSON string, so a parser gets the same value back.
 * Written as escapes so no invisible character sits in this source file.
 */
const INVISIBLE = /[\p{Cf}\p{Zl}\p{Zp}\p{Cc}\u{34f}\u{115f}\u{1160}\u{17b4}\u{17b5}\u{3164}\u{ffa0}\u{fe00}-\u{fe0f}\u{e0000}-\u{e007f}\u{e0100}-\u{e01ef}]/gu;

/** Kept as they are: tab, line feed, carriage return. */
const KEPT = new Set([0x09, 0x0a, 0x0d]);

const BACKSLASH = String.fromCharCode(0x5c);
const hex = (n: number) => n.toString(16).padStart(4, "0");

/** One code point as JSON escapes: a single escape for the BMP, a surrogate pair above it. */
function escapeCodePoint(ch: string): string {
  const cp = ch.codePointAt(0) as number;
  if (KEPT.has(cp)) return ch;
  if (cp <= 0xffff) return `${BACKSLASH}u${hex(cp)}`;
  const v = cp - 0x10000;
  return `${BACKSLASH}u${hex(0xd800 + (v >> 10))}${BACKSLASH}u${hex(0xdc00 + (v & 0x3ff))}`;
}

/** Replaces each invisible or direction-changing character with its JSON unicode escape. */
export function escapeInvisible(text: string): string {
  return text.replace(INVISIBLE, escapeCodePoint);
}

/**
 * The chat path escapes at value level: a copy of `value` in which every string (and every object key)
 * has its invisible characters replaced by visible escapes. The model and the chat UI receive objects,
 * not serialized text, so the escape is applied to each string. Numbers, booleans, and null pass through.
 */
export function escapeInvisibleDeep<T>(value: T): T {
  if (typeof value === "string") return escapeInvisible(value) as T;
  if (Array.isArray(value)) return value.map((v) => escapeInvisibleDeep(v)) as T;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[escapeInvisible(k)] = escapeInvisibleDeep(v);
    return out as T;
  }
  return value;
}

/** The first `max` code points; `truncated` says whether anything was cut (never splits a surrogate pair). */
export function cutCodePoints(text: string, max: number): { text: string; truncated: boolean } {
  const chars = Array.from(text);
  return chars.length <= max ? { text, truncated: false } : { text: chars.slice(0, max).join(""), truncated: true };
}
