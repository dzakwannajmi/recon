import { describe, expect, it } from "vitest";
import { extractionConfigKey } from "./config-key";

const base = { provider: "google", model: "gemini-flash-latest", doc: "doc-hash|A:1", assets: [{ code: "AAA", name: "Alpha" }] };

describe("extractionConfigKey", () => {
  it("keeps the google key as it was before providers existed (stored runs must not re-run)", () => {
    // Computed with the key function in scripts/extract-claims.ts before `provider` was added.
    expect(extractionConfigKey(base)).toBe("65feebdf7793e2f5f5c9e49d845a77b6");
  });
  it("changes with a non-google provider only", () => {
    expect(extractionConfigKey({ ...base, provider: "groq" })).not.toBe(extractionConfigKey(base));
    expect(extractionConfigKey({ ...base, provider: "groq" })).not.toBe(extractionConfigKey({ ...base, provider: "openrouter" }));
  });
});
