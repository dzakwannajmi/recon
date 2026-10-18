"use client";

import { ButtonLink } from "@/components/ui/button-link";
import { useAuth } from "@/components/auth/use-auth";
import { FEED_URL } from "./links";

/**
 * The "Live feed" link. With sign-in required it appears only for a signed-in user; it is hidden while the session is
 * loading and when signed out. Where sign-in is not set up (status "off") it stays visible.
 */
function useShowFeed() {
  const { status } = useAuth();
  return status === "in" || status === "off";
}

export function FeedButton({ className }: { className?: string }) {
  if (!useShowFeed()) return null;
  return <ButtonLink href={FEED_URL} target="_blank" rel="noopener noreferrer" className={className}>Live feed</ButtonLink>;
}

export function FeedMenuItem({ className }: { className?: string }) {
  if (!useShowFeed()) return null;
  return <li><a href={FEED_URL} target="_blank" rel="noopener noreferrer" className={className}>Live feed</a></li>;
}
