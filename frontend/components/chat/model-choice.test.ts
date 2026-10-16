import { describe, expect, it } from "vitest";
import { effectiveModelId, readModelChoice, saveModelChoice } from "./model-choice";

const models = [
  { id: "a", label: "A", note: null, default: true },
  { id: "b", label: "B", note: "not benchmarked for chat", default: false },
];

describe("model choice", () => {
  it("uses the remembered id only if the server offers it", () => {
    expect(effectiveModelId("b", models)).toBe("b");
    expect(effectiveModelId("gone", models)).toBe("a");
    expect(effectiveModelId(null, models)).toBe("a");
    expect(effectiveModelId("b", undefined)).toBeUndefined();
    expect(effectiveModelId("b", [])).toBeUndefined();
  });

  it("does not throw when storage is blocked", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readModelChoice(blocked)).toBeNull();
    expect(() => saveModelChoice("b", blocked)).not.toThrow();
    expect(readModelChoice(undefined)).toBeNull();
  });

  it("round-trips through storage", () => {
    const map = new Map<string, string>();
    const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
    saveModelChoice("b", storage);
    expect(readModelChoice(storage)).toBe("b");
  });
});
