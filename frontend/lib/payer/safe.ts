/**
 * Printing values that came from the server (which may be hostile via --base-url). A value is shown only
 * if it is a short code-like string; anything else (spaces, newlines, escape sequences, long text, an amount
 * in a sentence, a non-string) is replaced, so the terminal never shows server-chosen prose or control codes.
 */
export const NOT_SHOWN = "(not shown)";

const SAFE = /^[A-Za-z0-9_.:-]{1,80}$/;

export function safeValue(v: unknown): string {
  return typeof v === "string" && SAFE.test(v) ? v : NOT_SHOWN;
}

/** A boolean-or-unknown from the server, turned into our own words: never the server's text. */
export function safeBool(v: unknown): "true" | "false" | "unknown" {
  return v === true ? "true" : v === false ? "false" : "unknown";
}
