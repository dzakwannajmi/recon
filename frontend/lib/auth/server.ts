import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseConfig } from "./config";

/** A Supabase client bound to the request cookies (Route Handlers and Server Components). Null when sign-in is not set up. */
export async function serverClient() {
  const config = supabaseConfig();
  if (!config) return null;
  const store = await cookies();
  return createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(list) {
        // A Server Component cannot set cookies; the proxy refreshes the session there, so this is safe to skip.
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {}
      },
    },
  });
}

/** The signed-in user's id, checked with the Supabase auth server (not just decoded from the cookie), or null. */
export async function currentUserId(): Promise<string | null> {
  const client = await serverClient();
  if (!client) return null;
  const { data, error } = await client.auth.getUser();
  return error || !data.user ? null : data.user.id;
}
