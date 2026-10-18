/**
 * What the page knows about the signed-in user. The GitHub profile picture and login name come from the
 * sign-in itself; the picture is used only when it is an https image on GitHub's avatar host.
 */
export type AuthUser = { id: string; label: string; handle?: string; avatarUrl?: string };

const AVATAR_HOST = "avatars.githubusercontent.com";

/** The avatar URL if it is an https image on GitHub's avatar host, else undefined. */
export function githubAvatar(raw: unknown): string | undefined {
  if (typeof raw !== "string" || raw.length > 500) return undefined;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && u.hostname === AVATAR_HOST && !u.username && !u.password ? u.href : undefined;
  } catch {
    return undefined;
  }
}

type SessionUser = { id?: unknown; email?: unknown; user_metadata?: unknown } | null | undefined;

/** The user for the UI from a Supabase session user, or null if there is no usable id. */
export function toAuthUser(u: SessionUser): AuthUser | null {
  if (!u || typeof u.id !== "string" || u.id === "") return null;
  const meta = u.user_metadata && typeof u.user_metadata === "object" ? (u.user_metadata as Record<string, unknown>) : {};
  const pick = [meta.full_name, meta.name, meta.user_name, u.email].find((v): v is string => typeof v === "string" && v.trim() !== "");
  const handle = typeof meta.user_name === "string" && /^[A-Za-z0-9-]{1,39}$/.test(meta.user_name) ? meta.user_name : undefined;
  const avatarUrl = githubAvatar(meta.avatar_url);
  return { id: u.id, label: Array.from(pick ?? "Account").slice(0, 60).join(""), ...(handle ? { handle } : {}), ...(avatarUrl ? { avatarUrl } : {}) };
}

/** One uppercase letter for the avatar circle. */
export function initialOf(label: string): string {
  return (Array.from(label.trim())[0] ?? "?").toUpperCase();
}
