"use client";

import { useSyncExternalStore } from "react";
import { browserClient, signInWith, signOut as signOutClient } from "@/lib/auth/client";
import type { Provider } from "@/lib/auth/config";
import { toAuthUser, type AuthUser } from "@/lib/auth/user";

/** `off`: sign-in is not set up on this server. `loading`: the stored session has not been read yet. */
export type AuthState = { status: "off" | "loading" | "out" | "in"; user: AuthUser | null };

const LOADING: AuthState = { status: "loading", user: null };
let state: AuthState = LOADING;
let started = false;
const listeners = new Set<() => void>();

function set(next: AuthState) {
  state = next;
  listeners.forEach((l) => l());
}

// One listener for the whole page. The UI state only mirrors the session cookie; the server checks the user itself.
function start() {
  if (started) return;
  started = true;
  const client = browserClient();
  if (!client) return set({ status: "off", user: null });
  const apply = (user: ReturnType<typeof toAuthUser>) => set(user ? { status: "in", user } : { status: "out", user: null });
  void client.auth.getSession().then(({ data }) => apply(toAuthUser(data.session?.user)));
  client.auth.onAuthStateChange((_event, session) => apply(toAuthUser(session?.user)));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  start();
  return () => void listeners.delete(listener);
}

/** The sign-in state, shared by every component. Safe to render without a provider (server render shows `loading`). */
export function useAuth() {
  const s = useSyncExternalStore(subscribe, () => state, () => LOADING);
  return { ...s, signIn: (p: Provider) => signInWith(p), signOut: () => signOutClient() };
}
