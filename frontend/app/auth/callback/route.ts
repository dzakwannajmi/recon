import { NextResponse } from "next/server";
import { serverClient } from "@/lib/auth/server";

/**
 * GET /auth/callback?code=... : the OAuth redirect target. Exchanges the one-time code for a session (the cookies are
 * set by the server client) and sends the user to /agent. The destination is fixed, never taken from the request, so
 * this cannot be used as an open redirect. A missing or bad code goes to /agent too, signed out.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (code) {
    const client = await serverClient();
    if (client) {
      const { error } = await client.auth.exchangeCodeForSession(code);
      if (error) console.error("Sign-in code exchange failed.");
    }
  }
  const res = NextResponse.redirect(new URL("/agent", url.origin));
  res.headers.set("Cache-Control", "no-store");
  return res;
}
