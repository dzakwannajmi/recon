import { describe, expect, it } from "vitest";
import { FLAG_ORDER } from "../flags/types";
import { COPY } from "./copy";
import { LANGS } from "./copy-types";
import { loadStatus } from "./load";

/** Every string leaf with its key path. */
function leaves(value: unknown, prefix = ""): [string, string][] {
  if (typeof value === "string") return [[prefix, value]];
  if (Array.isArray(value)) return value.flatMap((v, i) => leaves(v, `${prefix}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
  }
  throw new Error(`Non-string leaf at ${prefix}: ${String(value)}`);
}

const placeholders = (s: string) => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();

const BANNED: [string, RegExp][] = [
  ["fraud", /fraud/i], ["scam", /scam/i], ["penipuan", /penipuan/i], ["grade", /grade/i], ["score", /score/i],
  ["skor", /skor/i], ["pricing", /pricing/i], ["subscription", /subscription/i], ["langganan", /langganan/i], ["$digit", /\$\d/],
];

describe("fact sheet copy", () => {
  for (const lang of LANGS) {
    it(`${lang}: every string is non-empty`, () => {
      const all = leaves(COPY[lang]);
      expect(all.length).toBeGreaterThan(50);
      for (const [key, s] of all) expect(s.trim().length, `${lang}:${key}`).toBeGreaterThan(0);
    });

    it(`${lang}: has no banned words`, () => {
      for (const [key, s] of leaves(COPY[lang])) {
        for (const [name, re] of BANNED) expect(re.test(s), `${lang}:${key} contains "${name}"`).toBe(false);
      }
    });

    it(`${lang}: has a name and a checks sentence for every flag`, () => {
      for (const f of FLAG_ORDER) {
        expect(COPY[lang].flags[f]?.name, `${lang}:${f}`).toBeTruthy();
        expect(COPY[lang].flags[f]?.checks, `${lang}:${f}`).toBeTruthy();
      }
    });

    it(`${lang}: labels every asset type in the real status file`, () => {
      const labels = COPY[lang].assetTypes as Record<string, string>;
      for (const t of new Set(loadStatus().status.assets.map((a) => a.asset_type))) expect(labels[t], `${lang}:${t}`).toBeTruthy();
    });
  }

  it("uses the same key paths and the same {placeholders} in every language", () => {
    const [first, ...rest] = LANGS;
    const base = new Map(leaves(COPY[first]));
    for (const lang of rest) {
      const other = new Map(leaves(COPY[lang]));
      expect([...other.keys()].sort()).toEqual([...base.keys()].sort());
      for (const [key, s] of base) expect(placeholders(other.get(key) as string), `${lang}:${key}`).toEqual(placeholders(s));
    }
  });
});
