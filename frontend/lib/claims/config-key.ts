import { createHash } from "node:crypto";
import { CLAIM_FIELDS } from "./fields";
import { EXTRACTION_INSTRUCTIONS, PROMPT_VERSION } from "./prompt";
import { MAX_CHARS_PER_DOCUMENT } from "./select";
import type { AssetRef } from "./verify";

/**
 * Everything that changes what the LLM sees, so a changed config never reuses an old run.
 * `provider` is added only when it is not google, so the keys of stored google runs stay what they were.
 */
export function extractionConfigKey(opts: { provider: string; model: string; doc: string; assets: AssetRef[] }) {
  const parts: unknown[] = [PROMPT_VERSION, EXTRACTION_INSTRUCTIONS, Object.keys(CLAIM_FIELDS), MAX_CHARS_PER_DOCUMENT, opts.model, opts.doc, opts.assets];
  if (opts.provider !== "google") parts.push({ provider: opts.provider });
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
}
