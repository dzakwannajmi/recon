import { describe, expect, it } from "vitest";
import { stripWakePhrase } from "./wake";

describe("stripWakePhrase", () => {
  it("drops a leading hey recon in any case and with punctuation", () => {
    expect(stripWakePhrase("hey recon check USTRY")).toBe("check USTRY");
    expect(stripWakePhrase("Hey Recon, what's in your wallet?")).toBe("what's in your wallet?");
    expect(stripWakePhrase("  HEY, RECON! fund your wallet")).toBe("fund your wallet");
  });
  it("leaves text without the wake words alone", () => {
    expect(stripWakePhrase("check USTRY")).toBe("check USTRY");
    expect(stripWakePhrase("hey there recon")).toBe("hey there recon");
  });
  it("only looks at the start", () => {
    expect(stripWakePhrase("tell me what hey recon means")).toBe("tell me what hey recon means");
  });
  it("does not match a longer word", () => {
    expect(stripWakePhrase("hey reconcile the books")).toBe("hey reconcile the books");
  });
  it("returns an empty string when only the wake words were said", () => {
    expect(stripWakePhrase("hey recon")).toBe("");
    expect(stripWakePhrase("Hey, Recon.")).toBe("");
  });
  it("strips once", () => {
    expect(stripWakePhrase("hey recon hey recon hi")).toBe("hey recon hi");
  });
});
