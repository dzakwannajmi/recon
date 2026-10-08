import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MIN_HTML_CHARS, OUTPUT_TOKENS } from "./docs";

// docs.ts repeats two constants of scripts/extract-claims.ts (which the benchmark must not change); this catches drift.
describe("constants shared with extract:claims", () => {
  const source = fs.readFileSync(fileURLToPath(new URL("../../scripts/extract-claims.ts", import.meta.url)), "utf8");
  const read = (name: string) => Number(new RegExp(`const ${name} = (\\d[\\d_]*);`).exec(source)?.[1]?.replace(/_/g, ""));

  it("MIN_HTML_CHARS matches", () => expect(MIN_HTML_CHARS).toBe(read("MIN_HTML_CHARS")));
  it("OUTPUT_TOKENS matches", () => expect(OUTPUT_TOKENS).toBe(read("OUTPUT_TOKENS")));
});
