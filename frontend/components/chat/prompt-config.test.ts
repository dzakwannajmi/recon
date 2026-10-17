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

  it("lists the pickable models with the note or the default as the tag", () => {
    const list = [
      { id: "a", label: "A", note: null, default: true },
      { id: "b", label: "B", note: "not benchmarked for chat", default: false },
      { id: "c", label: "C", note: null, default: false },
    ];
    expect(promptModels("m1", list)).toEqual([
      { key: "a", name: "A", tag: "default" },
      { key: "b", name: "B", tag: "not benchmarked for chat" },
      { key: "c", name: "C", tag: undefined },
    ]);
  });

  it("has the commands, including /evidence", () => {
    expect(PROMPT_COMMANDS.map((c) => c.name)).toEqual(["/check", "/flags", "/status", "/claims", "/evidence"]);
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

  it("keeps a whole command as a command (the page runs it without the model), with the mention stripped", () => {
    expect(preparePrompt("/check @USTRY ", assets)).toBe("/check USTRY");
    expect(preparePrompt("/evidence @BENJI", assets)).toBe("/evidence BENJI");
    expect(preparePrompt("/status BENJI", assets)).toBe("/status BENJI");
  });

  it("sends a command with extra words to the model as a prompt, and unknown commands as text", () => {
    expect(preparePrompt("/claims USTRY and the custodian", assets)).toBe("Show the verified claims for USTRY. and the custodian");
    expect(preparePrompt("/evidence USTRY please", assets)).toBe("/evidence USTRY please");
    expect(preparePrompt("/nope USTRY", assets)).toBe("/nope USTRY");
    expect(preparePrompt("/check", assets)).toBe("/check");
  });
});
