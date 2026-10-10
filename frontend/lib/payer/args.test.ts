import { describe, expect, it } from "vitest";
import { USAGE, parseArgs, validateBaseUrl } from "./args";

const ISSUER = "GD436PARIAIVGQMI4O54RRKGBL6H7T3BPPKFSTYQGSG3727SXRCGE4S4";

describe("parseArgs", () => {
  it("prints usage for --help", () => {
    expect(parseArgs(["--help"])).toEqual({ kind: "help" });
    expect(USAGE).toContain("Usage: npm run check:paid");
  });

  it("takes an asset and defaults to the local server", () => {
    expect(parseArgs(["--asset", "gBENJI"])).toEqual({ kind: "run", args: { asset: "gBENJI", baseUrl: "http://localhost:3000", replayCheck: false } });
  });

  it("takes an issuer, a base URL, and the replay flag", () => {
    expect(parseArgs(["--asset", "X", "--issuer", ISSUER, "--base-url", "https://example.org/", "--replay-check"])).toEqual({
      kind: "run",
      args: { asset: "X", issuer: ISSUER, baseUrl: "https://example.org", replayCheck: true },
    });
  });

  it("refuses a missing or bad asset, a bad issuer, an unknown flag, and a flag without a value", () => {
    for (const argv of [[], ["--asset"], ["--asset", "a-b"], ["--asset", "X", "--issuer", "GABC"], ["--asset", "X", "--nope"], ["--asset", "X", "--base-url"]]) {
      expect(parseArgs(argv).kind, argv.join(" ")).toBe("error");
    }
  });
});

describe("validateBaseUrl", () => {
  it("allows http only for localhost and 127.0.0.1, and https anywhere", () => {
    expect(validateBaseUrl("http://localhost:3000")).toBe("http://localhost:3000");
    expect(validateBaseUrl("http://127.0.0.1:3100/")).toBe("http://127.0.0.1:3100");
    expect(validateBaseUrl("https://recon.example.org")).toBe("https://recon.example.org");
  });

  it("refuses other http hosts, credentials, queries, and other schemes", () => {
    for (const bad of ["http://example.org", "http://localhost.evil.example", "https://u:p@example.org", "https://example.org/?a=1", "ftp://localhost", "not a url", "file:///etc/passwd"]) {
      expect(validateBaseUrl(bad), bad).toBeNull();
    }
  });
});
