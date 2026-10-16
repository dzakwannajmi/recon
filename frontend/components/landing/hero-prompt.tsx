"use client";

import { useRouter } from "next/navigation";
import { PromptField } from "@/components/chat/prompt-input";
import type { PromptAsset } from "@/components/chat/prompt-config";
import { handoffFor, storeHandoff } from "@/components/chat/handoff";

/** The hero's input. Sending opens /agent with the question; /agent asks it once, only for this handoff. */
export function HeroPrompt({ assets }: { assets: PromptAsset[] }) {
  const router = useRouter();
  return (
    <PromptField
      assets={assets}
      width={640}
      placeholder="Check USTRY on Stellar mainnet"
      onSend={(text) => {
        const h = handoffFor(text);
        if (!h) return;
        storeHandoff(window.sessionStorage, h.token);
        router.push(h.href);
      }}
    />
  );
}
