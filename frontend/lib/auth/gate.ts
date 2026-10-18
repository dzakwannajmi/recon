import { authRequired, SIGN_IN_REQUIRED_MESSAGE } from "./config";

// Loaded only when the gate is on, so the anonymous path never touches cookies or the Supabase client.
const lookup = async () => (await import("./server")).currentUserId();

/**
 * The sign-in gate of the chat routes. Returns null to let the request through, or the 401 to send back.
 * Off (the default): returns null without looking at any cookie, so anonymous use is untouched. On: needs a signed-in
 * user; a failed lookup (or sign-in not set up) answers 401 too, never lets the request through. Nothing is
 * cached, so signing out takes effect on the next request.
 */
export async function signInGate(currentUserId: () => Promise<string | null> = lookup): Promise<Response | null> {
  if (!authRequired()) return null;
  let id: string | null = null;
  try {
    id = await currentUserId();
  } catch {
    id = null;
  }
  return id ? null : Response.json({ error: SIGN_IN_REQUIRED_MESSAGE }, { status: 401, headers: { "Cache-Control": "no-store" } });
}
