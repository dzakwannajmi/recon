import { describe, expect, it } from "vitest";
import { expandCommand, preparePrompt, promptModels, promptSources, PROMPT_COMMANDS, stripAssetMentions } from "./prompt-config";

const assets = [{ code: "USTRY", description: "Franklin" }, { code: "BENJI", description: "fund" }];

describe("prompt config", () => {
  it("builds sources from assets with no attach rows", () => {
    const s = promptSources(assets);
    expect(s.map((x) => x.name)).toEqual(["USTRY", "BENJI"]);
    expect(s.every((x) => !x.attach)).toBe(true);
  });

  it("lists the model the server reports, or none", () => {
    expect(promptModels("m1")).toEqual([{ key: "m1", name: "m1" }]);
    expect(promptModels(undefined)).toEqual([]);
  });

  it("has the four commands", () => {
    expect(PROMPT_COMMANDS.map((c) => c.name)).toEqual(["/check", "/flags", "/status", "/claims"]);
  });

  it("strips @ only for tracked codes", () => {
    expect(stripAssetMentions("check @USTRY and @nobody", assets)).toBe("check USTRY and @nobody");
  });

  it("expands commands into prompts and leaves bare commands alone", () => {
    expect(expandCommand("/check USTRY")).toBe("Check USTRY on Stellar mainnet");
    expect(expandCommand("/flags BENJI")).toBe("List the flags for BENJI");
    expect(expandCommand("/status BENJI")).toBe("What is the status of BENJI?");
    expect(expandCommand("/claims USTRY extra words")).toBe("Show the verified claims for USTRY. extra words");
    expect(expandCommand("/check")).toBe("/check");
    expect(expandCommand("/other X")).toBe("/other X");
    expect(expandCommand("hello /check USTRY")).toBe("hello /check USTRY");
  });

  it("prepares a prompt typed with a mention", () => {
    expect(preparePrompt("/check @USTRY ", assets)).toBe("Check USTRY on Stellar mainnet");
  });
});
