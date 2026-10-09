/**
 * What is stored for a failed LLM call: the error name plus the HTTP status and a
 * short provider code, never the message (it can echo request details), with
 * any provider API key redacted if it ever shows up.
 */
export function describeError(err: unknown) {
  if (!(err instanceof Error)) return "non-Error thrown";
  const e = err as Error & { statusCode?: unknown; code?: unknown; data?: { error?: { status?: unknown; code?: unknown } } };
  const short = (v: unknown) => (typeof v === "string" && /^[A-Za-z0-9_.-]{2,40}$/.test(v) ? v : null);
  const parts = [err.name, typeof e.statusCode === "number" ? `HTTP ${e.statusCode}` : null, short(e.data?.error?.status) ?? short(e.data?.error?.code) ?? short(e.code)].filter(Boolean);
  let text = parts.join(" ");
  for (const name of ["GEMINI_API_KEY", "GROQ_API_KEY", "OPENROUTER_API_KEY"]) {
    const key = process.env[name];
    if (key) text = text.split(key).join("[redacted]");
  }
  return text.slice(0, 120);
}
