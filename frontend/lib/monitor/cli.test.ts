import { describe, expect, it } from "vitest";
import { parseArgs } from "../../scripts/monitor";

describe("npm run monitor: arguments", () => {
  it("parses every documented flag", () => {
    expect(parseArgs([])).toEqual({});
    expect(parseArgs(["--dry-run", "--no-recheck", "--recheck-now"])).toEqual({ dryRun: true, noRecheck: true, forced: true });
    expect(parseArgs(["--replay-from", "2026-10-06", "--issuer", "GAAA", "--issuer", "GBBB"])).toEqual({ replayFrom: "2026-10-06", replayIssuers: ["GAAA", "GBBB"] });
    expect(parseArgs(["--lookback-hours", "7"])).toEqual({ lookbackHours: 7 });
  });

  it("refuses anything else", () => {
    for (const bad of [["--wat"], ["--replay-from"], ["--lookback-hours", "0"], ["--lookback-hours", "49"], ["--lookback-hours", "1.5"], ["--issuer", "GAAA"], ["--replay-from", "2026-10-06", "--lookback-hours", "3"], ["--env-file", ".env"]]) {
      expect(() => parseArgs(bad), bad.join(" ")).toThrow();
    }
  });
});
