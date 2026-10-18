import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authRequired, supabaseConfig } from "@/lib/auth/config";

/** The fact sheet pages. With sign-in required they need a signed-in user; the machine endpoints (/api/check, MCP, the feed contract) stay open. */
const SHEETS = /^\/(en|id)\/assets(\/|$)/;

/**
 * Keeps the Supabase session fresh: refreshes an expiring access token and writes the new cookies to the request
 * and the response. Anonymous visits to open pages (the landing page, /login, /privacy) do no extra work. When sign-in
 * is required, the fact sheet pages send a visitor without a valid session to /login; the chat routes decide
 * access themselves (lib/auth/gate.ts).
 */
export async function proxy(request: NextRequest) {
  const cfg = supabaseConfig();
  const gated = authRequired() && SHEETS.test(request.nextUrl.pathname);
  const hasSession = request.cookies.getAll().some((c) => c.name.startsWith("sb-"));
  if (!cfg || (!hasSession && !gated)) return NextResponse.next({ request });

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
  const { data, error } = await supabase.auth.getUser();
  if (gated && (error || !data.user)) {
    const redirect = NextResponse.redirect(new URL("/login", request.url));
    redirect.headers.set("Cache-Control", "no-store");
    return redirect;
  }
  return response;
}

export const config = {
  // Pages and the chat routes. Static files and images never need a session.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|logo-mark.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
