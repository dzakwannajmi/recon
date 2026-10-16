import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { FRANKLIN_ILLUSTRATION, initialsOf, LOGO_FILES, logoFor, orbitAssets } from "./logos";
import { loadStatus } from "./load";
import { groupByIssuer } from "./stats";

describe("logos", () => {
  it("maps only to files that exist under public/logos", () => {
    for (const file of Object.values(LOGO_FILES)) {
      expect(fs.existsSync(path.join(process.cwd(), "public", "logos", file)), file).toBe(true);
    }
  });
  it("returns a local path for a mapped code and null otherwise", () => {
    expect(logoFor("USDY")).toBe("/logos/usdy.png");
    expect(logoFor("YLDS")).toBe("/logos/figure.svg");
    expect(logoFor("BENJI")).toBeNull();
    expect(logoFor("gBENJI")).toBeNull();
    expect(logoFor("toString")).toBeNull();
    expect(logoFor("__proto__")).toBeNull();
  });
  it("makes initials", () => {
    expect(initialsOf("gBENJI")).toBe("GB");
  });
});

describe("orbitAssets", () => {
  it("keeps every asset, gives Franklin Templeton the illustration, and spreads a big group out", () => {
    const out = orbitAssets([
      { issuer: "WisdomTree", assets: [{ code: "GOLD" }, { code: "TIPS" }, { code: "TECH" }, { code: "EQTY" }] },
      { issuer: "Franklin Templeton", assets: [{ code: "BENJI" }, { code: "X" }] },
      { issuer: "Unknown", assets: [{ code: "NOPE" }] },
    ]);
    expect(out).toHaveLength(7);
    expect(out.find((o) => o.code === "BENJI")?.src).toBe(FRANKLIN_ILLUSTRATION);
    expect(out.find((o) => o.code === "NOPE")?.src).toBeNull();
    expect(out[0].issuer).not.toBe(out[1].issuer);
  });
  it("points the illustration at a file that exists", () => {
    expect(fs.existsSync(path.join(process.cwd(), "public", FRANKLIN_ILLUSTRATION))).toBe(true);
  });
});

describe("groupByIssuer on the newest status file", () => {
  const { status } = loadStatus();
  const groups = groupByIssuer(status);
  it("covers every asset exactly once", () => {
    const codes = groups.flatMap((g) => g.assets.map((a) => a.code));
    expect(codes.sort()).toEqual(status.assets.map((a) => a.asset_code).sort());
  });
  it("has one group per issuer organisation", () => {
    expect(groups.map((g) => g.issuer)).toEqual([...new Set(status.assets.map((a) => a.issuer_org))]);
  });
});
