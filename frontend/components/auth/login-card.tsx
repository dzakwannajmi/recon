"use client";

import Link from "next/link";
import { useState } from "react";
import { useAuth } from "./use-auth";

/** The GitHub mark (Octicons mark-github, 16px grid). */
export function GithubMark({ className = "size-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={className} fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8" />
    </svg>
  );
}

/**
 * Sign in with GitHub. Used on /login and as the gate on /agent. Signed in already: a link to the agent instead.
 * Fact sheets and the Live feed link need an account too; the on-chain feed contract and the check API stay open for programs.
 */
export function LoginCard({ heading = "Sign in to use the agent" }: { heading?: string }) {
  const auth = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="mx-auto flex w-full max-w-[420px] flex-col gap-5 rounded-[16px] border bg-card p-6 sm:p-8">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl">{heading}</h2>
        <p className="text-sm text-muted-foreground">Sign in to chat with the agent. Your chats and the evidence you unlock are saved to your account.</p>
      </div>

      {auth.status === "off" && <p role="alert" className="text-sm text-muted-foreground">Sign-in is not set up on this server yet.</p>}
      {auth.status === "in" && (
        <Link href="/agent" className="inline-flex h-11 items-center justify-center rounded-[6px] bg-foreground px-4 text-sm text-background hover:bg-[#2c2c2c] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground">
          Open the agent
        </Link>
      )}
      {(auth.status === "out" || auth.status === "loading") && (
        <button
          type="button"
          disabled={busy || auth.status === "loading"}
          className="inline-flex h-11 items-center justify-center gap-2.5 rounded-[6px] bg-foreground px-4 text-sm text-background hover:bg-[#2c2c2c] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground disabled:opacity-60"
          onClick={async () => {
            setBusy(true);
            const message = await auth.signIn("github");
            setError(message);
            if (message) setBusy(false);
          }}
        >
          <GithubMark />
          Continue with GitHub
        </button>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      <p className="text-xs text-muted-foreground">
        By continuing you agree to how we handle your account data. <Link href="/privacy" className="underline underline-offset-4">Privacy</Link>
      </p>
    </div>
  );
}
