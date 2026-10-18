/**
 * Sign-in settings, read from the environment. The two Supabase values are public by design (they ship to the
 * browser); there is no service-role key anywhere in the app. NEXT_PUBLIC_* names must be written out in full so
 * Next.js can inline them into the browser bundle.
 */
export type SupabaseConfig = { url: string; anonKey: string };

export const SIGN_IN_REQUIRED_MESSAGE = "Sign in with Google or GitHub to use the agent.";
export const PROVIDERS = ["google", "github"] as const;
export type Provider = (typeof PROVIDERS)[number];

/** The Supabase project URL and anon key, or null when sign-in is not set up (then every sign-in control stays hidden). */
export function supabaseConfig(): SupabaseConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return null;
  try {
    if (new URL(url).protocol !== "https:" && new URL(url).hostname !== "localhost") return null;
  } catch {
    return null;
  }
  return { url, anonKey };
}

/** AUTH_REQUIRED=true makes the chat routes need a signed-in user. Anything else (including unset) leaves sign-in optional. */
export function authRequired(): boolean {
  return process.env.AUTH_REQUIRED === "true";
}
