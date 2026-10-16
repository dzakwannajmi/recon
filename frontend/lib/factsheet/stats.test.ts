import { describe, expect, it } from "vitest";
import { asset, statusFile } from "./fixtures";
import { statsFrom } from "./stats";

describe("statsFrom", () => {
  it("counts assets and distinct issuers", () => {
    const status = statusFile([
      asset({ asset_code: "A", issuer_org: "One", status: "OK" }),
      asset({ asset_code: "B", issuer_org: "One", status: "WARNING" }),
      asset({ asset_code: "C", issuer_org: "Two", status: null }),
    ]);
    expect(statsFrom(status)).toEqual({ assets: 3, issuers: 2 });
  });
});
