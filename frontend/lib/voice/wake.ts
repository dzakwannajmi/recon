/**
 * Optional wake words for call mode. A leading "hey recon" is dropped from what the user said; the rest is
 * the message. Only the start of the text is looked at, so "tell me what hey recon means" is left as it is.
 */
const WAKE = /^\s*hey[\s,.!:;-]+recon\b[\s,.!:;?-]*/i;

export function stripWakePhrase(transcript: string): string {
  return transcript.replace(WAKE, "").trim();
}
