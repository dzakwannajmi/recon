import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseConfig, type Provider } from "./config";

let client: SupabaseClient | null | undefined;

/** The browser Supabase client (one per page), or null when sign-in is not set up. Uses the public anon key only. */
export function browserClient(): SupabaseClient | null {
  if (client !== undefined) return client;
  const config = supabaseConfig();
  client = config ? createBrowserClient(config.url, config.anonKey) : null;
  return client;
}

/** Starts the OAuth round trip. Supabase sends the browser to the provider, then to /auth/callback. */
export async function signInWith(provider: Provider, c: SupabaseClient | null = browserClient()): Promise<string | null> {
  if (!c) return "Sign-in is not set up on this server.";
  const { error } = await c.auth.signInWithOAuth({ provider, options: { redirectTo: `${window.location.origin}/auth/callback` } });
  return error ? "Could not start sign-in. Try again in a moment." : null;
}

export async function signOut(c: SupabaseClient | null = browserClient()) {
  await c?.auth.signOut();
}
