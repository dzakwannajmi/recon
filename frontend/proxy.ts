import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseConfig } from "@/lib/auth/config";

/**
 * Keeps the Supabase session fresh: refreshes an expiring access token and writes the new cookies to the request
 * and the response. It only runs the refresh for a visitor who already has a session cookie, so anonymous visits
 * (the landing page, fact sheets, the feed) do no extra work. It never blocks or redirects; the chat routes decide
 * access themselves (lib/auth/gate.ts).
 */
export async function proxy(request: NextRequest) {
  const cfg = supabaseConfig();
  const hasSession = request.cookies.getAll().some((c) => c.name.startsWith("sb-"));
  if (!cfg || !hasSession) return NextResponse.next({ request });

  let response = NextResponse.next({ request });
  const supabase = createServerClient(cfg.url, cfg.anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(list) {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  // getUser() validates the token with the auth server and refreshes it when needed.
  await supabase.auth.getUser();
  return response;
}

export const config = {
  // Pages and the chat routes. Static files and images never need a session.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|logo-mark.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
