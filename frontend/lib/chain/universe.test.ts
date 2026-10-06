import { afterEach, describe, expect, it, vi } from "vitest";
import { officialDomainsFor, parseCsv, pinnedDomainsFor, universeFromCsv } from "./universe";

describe("parseCsv", () => {
  it("parses plain rows and skips blank lines", () => {
    expect(parseCsv("a,b\n1,2\n\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("handles quoted commas, escaped quotes, and newlines inside quotes", () => {
    expect(parseCsv('code,notes\nBENJI,"one, two"\nUSDY,"say ""hi"""\nX,"line1\nline2"')).toEqual([
      ["code", "notes"],
      ["BENJI", "one, two"],
      ["USDY", 'say "hi"'],
      ["X", "line1\nline2"],
    ]);
  });

  it("handles CRLF line endings and a missing trailing newline", () => {
    expect(parseCsv("a,b\r\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("universeFromCsv", () => {
  afterEach(() => vi.restoreAllMocks());

  const CSV = [
    "﻿asset_code,issuer,home_domain,official_domain",
    "BENJI,GA,WWW.FranklinTempleton.com.,https://FranklinTempleton.com/",
    "gBENJI,GB,www.franklintempleton.com,franklintempleton.com",
    "BAD,GC,bad.com,127.0.0.1",
    "USDY,GD,,ondo.finance",
  ].join("\n");

  it("normalizes domains and skips rows without a valid official domain", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const universe = universeFromCsv(CSV);
    expect(universe.map((a) => a.asset_code)).toEqual(["BENJI", "gBENJI", "USDY"]);
    expect(universe[0].official_domain).toBe("franklintempleton.com");
    expect(universe[0].home_domain).toBe("www.franklintempleton.com");
    expect(universe[2].home_domain).toBe("");
  });

  it("returns official and pinned domains per code", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const universe = universeFromCsv(CSV);
    expect(officialDomainsFor(universe, "BENJI")).toEqual(["franklintempleton.com"]);
    expect(pinnedDomainsFor(universe, "BENJI")).toEqual(["franklintempleton.com", "www.franklintempleton.com"]);
    expect(pinnedDomainsFor(universe, "USDY")).toEqual(["ondo.finance"]);
    expect(officialDomainsFor(universe, "NOPE")).toEqual([]);
  });
});
