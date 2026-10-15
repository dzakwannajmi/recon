import { describe, expect, it } from "vitest";
import { gateMode } from "./gate-mode";

const env = { reducedMotion: false, webgl: true, narrow: false };

describe("gateMode", () => {
  it("runs the full effect on a wide screen with WebGL", () => {
    expect(gateMode(env, "static")).toBe("full");
  });
  it("is static with reduced motion, even when the screen is wide", () => {
    expect(gateMode({ ...env, reducedMotion: true }, "light")).toBe("static");
  });
  it("is static without WebGL", () => {
    expect(gateMode({ ...env, webgl: false }, "light")).toBe("static");
  });
  it("uses the caller's choice on a narrow screen", () => {
    expect(gateMode({ ...env, narrow: true }, "light")).toBe("light");
    expect(gateMode({ ...env, narrow: true }, "static")).toBe("static");
  });
});
