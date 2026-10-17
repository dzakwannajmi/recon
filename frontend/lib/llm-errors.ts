/**
 * What is stored for a failed LLM call: the error name plus the HTTP status and a
 * short provider code, never the message (it can echo request details), with
 * any provider API key redacted if it ever shows up.
 */
export function describeError(err: unknown): string {
  if (!(err instanceof Error)) return "non-Error thrown";
  // A retry wrapper (AI_RetryError) hides the real cause: describe the last attempt's error after its own name.
  const last = (err as Error & { lastError?: unknown }).lastError;
  if (last instanceof Error && last !== err) return `${err.name} > ${describeError(last)}`.slice(0, 160);
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

/** Words safe to show when a provider refuses or is down. They name what to do and never carry provider text. */
export const PROVIDER_BUSY_MESSAGE = "This model's provider is busy (rate limited). Pick another model or try later.";
export const PROVIDER_DOWN_MESSAGE = "This model's provider is unavailable right now. Pick another model or try later.";

/**
 * The HTTP status a provider answered with, looking through a retry wrapper (AI_RetryError.lastError) and error causes.
 * Only 429 and 503 are mapped; anything else stays a generic failure. Never returns provider text.
 */
export function providerFailure(err: unknown): { status: 429 | 503; message: string } | null {
  const seen = new Set<unknown>();
  for (let e: unknown = err; e instanceof Error && !seen.has(e) && seen.size < 6; ) {
    seen.add(e);
    const status = (e as { statusCode?: unknown }).statusCode;
    if (status === 429) return { status: 429, message: PROVIDER_BUSY_MESSAGE };
    if (status === 503) return { status: 503, message: PROVIDER_DOWN_MESSAGE };
    e = (e as { lastError?: unknown }).lastError ?? (e as { cause?: unknown }).cause;
  }
  return null;
}
