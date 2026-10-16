import { describe, expect, it } from "vitest";
import { folderSize } from "./folder-size";

describe("folderSize", () => {
  it("scales with the container", () => {
    expect(folderSize(392)).toBe(1);
  });
  it("keeps the folder between 0.6 and 1.5", () => {
    expect(folderSize(100)).toBe(0.6);
    expect(folderSize(2000)).toBe(1.5);
  });
  it("steps by 0.02", () => {
    expect(folderSize(500) * 50).toBeCloseTo(Math.round(folderSize(500) * 50));
  });
});
