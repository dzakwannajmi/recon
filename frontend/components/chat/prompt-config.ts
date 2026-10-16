import { BankIcon } from "@hugeicons/core-free-icons";
import type { PromptBarCommand, PromptBarModel, PromptBarSource } from "@/components/effects/PromptBar";

/**
 * What the prompt bar offers, in one place so every bar (the agent page, the landing) is configured the same.
 * Only real Recon things: the tracked assets, the commands the agent's tools answer, the model the server reports.
 * No attachments (no attach source, no onAttach) and no effort setting.
 */

/** One tracked asset as the bar shows it: the code, and the issuer or the type as the description. */
export type PromptAsset = { code: string; description: string };

export const PROMPT_COMMANDS: PromptBarCommand[] = [
  { key: "check", name: "/check", description: "Check <asset>" },
  { key: "flags", name: "/flags", description: "List flags for <asset>" },
  { key: "status", name: "/status", description: "Status of <asset>" },
  { key: "claims", name: "/claims", description: "Show verified claims for <asset>" },
];

/** The prompt each command stands for. Each one maps to a tool the agent already has. */
const TEMPLATES: Record<string, (asset: string) => string> = {
  check: (a) => `Check ${a} on Stellar mainnet`,
  flags: (a) => `List the flags for ${a}`,
  status: (a) => `What is the status of ${a}?`,
  claims: (a) => `Show the verified claims for ${a}`,
};

/** Sources behind the plus button and "@". Choosing one puts the asset code in the text. No attach rows. */
export function promptSources(assets: PromptAsset[]): PromptBarSource[] {
  return assets.map((a) => ({ key: a.code, name: a.code, description: a.description, icon: BankIcon }));
}

/** The model the server reports, as a one-entry read-only list; none until the status has loaded. */
export function promptModels(model: string | undefined): PromptBarModel[] {
  return model ? [{ key: model, name: model }] : [];
}

/** "@USTRY" becomes "USTRY" when it is a tracked code, so the agent sees the plain code. */
export function stripAssetMentions(text: string, assets: PromptAsset[]): string {
  const codes = new Set(assets.map((a) => a.code));
  return text.replace(/(^|\s)@([\w-]+)/g, (m, lead: string, code: string) => (codes.has(code) ? `${lead}${code}` : m));
}

/** "/check USTRY" becomes the full prompt. A command without an asset code is left as typed. */
export function expandCommand(text: string): string {
  const m = /^\/(check|flags|status|claims)\s+([A-Za-z0-9]{1,12})(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!m) return text;
  const base = TEMPLATES[m[1]](m[2]);
  return m[3]?.trim() ? `${base}. ${m[3].trim()}` : base;
}

/** What is sent to the agent for what the user typed or picked. */
export const preparePrompt = (text: string, assets: PromptAsset[]) => expandCommand(stripAssetMentions(text, assets));
