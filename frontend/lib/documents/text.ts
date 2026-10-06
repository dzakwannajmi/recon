/** Text normalization shared by every extractor (and, in W2.2, by the quote verifier). */

/** Collapse runs of spaces and blank lines; trim each line. */
export function normalizeWhitespace(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\t  ]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Replace control characters (including form feeds) with spaces, so only real page breaks remain. */
export function stripControlChars(text: string) {
  return text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, " ");
}
