"use client";

import Link from "next/link";
import { useState } from "react";
import { PROVIDERS, type Provider } from "@/lib/auth/config";
import { initialOf, type AuthUser } from "@/lib/auth/user";
import { browserClient } from "@/lib/auth/client";
import { deleteMyData } from "@/lib/history/store";
import { announceHistoryChanged } from "@/components/chat/use-history";
import { useAuth } from "./use-auth";

const PROVIDER_LABEL: Record<Provider, string> = { github: "GitHub" };
const item = "w-full rounded-[6px] px-3 py-2 text-left text-sm hover:bg-secondary focus-visible:outline-2 focus-visible:outline-foreground";
const panel = "absolute right-0 z-50 mt-2 flex w-56 flex-col gap-1 rounded-[16px] border bg-card p-2";
const summary = "flex h-10 cursor-pointer list-none items-center rounded-[6px] px-4 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground [&::-webkit-details-marker]:hidden";

/** The two provider buttons, also used by the sign-in gate on /agent. */
export function ProviderButtons({ className = "" }: { className?: string }) {
  const auth = useAuth();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {PROVIDERS.map((p) => (
        <button key={p} type="button" className={`${item} border bg-background text-center`} onClick={async () => setError(await auth.signIn(p))}>
          Continue with {PROVIDER_LABEL[p]}
        </button>
      ))}
      {error && <p role="alert" className="px-3 text-xs text-destructive">{error}</p>}
    </div>
  );
}

/** The GitHub profile picture when there is one (and it loads), else the initial. No referrer is sent to the image host. */
function Avatar({ user }: { user: AuthUser }) {
  const [broken, setBroken] = useState(false);
  if (user.avatarUrl && !broken) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" className="size-full rounded-full object-cover" onError={() => setBroken(true)} />;
  }
  return <>{initialOf(user.label)}</>;
}

/** "Sign in" (ink) when signed out; an initial-letter menu when signed in. Renders nothing when sign-in is not set up. */
export function UserMenu() {
  const auth = useAuth();
  const [note, setNote] = useState<string | null>(null);
  if (auth.status === "off" || auth.status === "loading") return null;

  if (auth.status === "out") {
    return (
      <details className="group relative">
        <summary className={`${summary} bg-foreground text-background hover:bg-[#2c2c2c]`}>Sign in</summary>
        <div className={panel}>
          <p className="px-3 py-1 text-xs text-muted-foreground">Optional. Saves your chats and paid evidence.</p>
          <ProviderButtons />
        </div>
      </details>
    );
  }

  async function wipe(userId: string) {
    const db = browserClient();
    if (!db || !window.confirm("Delete all your saved chats and saved evidence? This cannot be undone.")) return;
    try {
      await deleteMyData(db, userId);
      announceHistoryChanged();
      setNote("Your saved data was deleted.");
    } catch {
      setNote("Could not delete your data. Try again in a moment.");
    }
  }

  const user = auth.user!;
  return (
    <details className="group relative">
      <summary aria-label={`Account menu, ${user.label}`} className="flex size-10 cursor-pointer list-none items-center justify-center rounded-full border bg-primary text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground [&::-webkit-details-marker]:hidden">
        <Avatar user={user} />
      </summary>
      <div className={panel}>
        <p className="truncate px-3 py-1 text-xs text-muted-foreground">
          {user.label}
          {user.handle && user.handle !== user.label && <span className="block">@{user.handle}</span>}
        </p>
        <Link href="/agent#saved-chats" className={item}>Saved chats</Link>
        <Link href="/agent#saved-evidence" className={item}>Saved evidence</Link>
        <button type="button" className={item} onClick={() => void wipe(user.id)}>Delete my data</button>
        <Link href="/privacy" className={item}>Privacy</Link>
        <button type="button" className={item} onClick={() => void auth.signOut()}>Sign out</button>
        {note && <p role="status" className="px-3 py-1 text-xs">{note}</p>}
      </div>
    </details>
  );
}
