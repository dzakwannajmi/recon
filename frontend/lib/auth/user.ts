/** What the page knows about the signed-in user. No avatar URL: the menu shows an initial, so no third-party image is loaded. */
export type AuthUser = { id: string; label: string };

type SessionUser = { id?: unknown; email?: unknown; user_metadata?: unknown } | null | undefined;

/** The user for the UI from a Supabase session user, or null if there is no usable id. */
export function toAuthUser(u: SessionUser): AuthUser | null {
  if (!u || typeof u.id !== "string" || u.id === "") return null;
  const meta = u.user_metadata && typeof u.user_metadata === "object" ? (u.user_metadata as Record<string, unknown>) : {};
  const pick = [meta.full_name, meta.name, meta.user_name, u.email].find((v): v is string => typeof v === "string" && v.trim() !== "");
  return { id: u.id, label: Array.from(pick ?? "Account").slice(0, 60).join("") };
}

/** One uppercase letter for the avatar circle. */
export function initialOf(label: string): string {
  return (Array.from(label.trim())[0] ?? "?").toUpperCase();
}
