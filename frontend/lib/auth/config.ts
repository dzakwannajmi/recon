/**
 * Sign-in settings, read from the environment. The two Supabase values are public by design (they ship to the
 * browser); there is no service-role key anywhere in the app. NEXT_PUBLIC_* names must be written out in full so
 * Next.js can inline them into the browser bundle.
 */
export type SupabaseConfig = { url: string; anonKey: string };

export const SIGN_IN_REQUIRED_MESSAGE = "Sign in with GitHub to use the agent.";
export const PROVIDERS = ["github"] as const;
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

/**
 * Signing in is required to use the agent chat whenever sign-in is set up (the two Supabase values exist). The only
 * way out is AUTH_REQUIRED=false, for local work. Without the Supabase values there is nothing to sign in to, so the
 * chat stays open instead of locking everyone out.
 */
export function authRequired(): boolean {
  return supabaseConfig() !== null && process.env.AUTH_REQUIRED !== "false";
}
