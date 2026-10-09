import { describe, expect, it } from "vitest";
import { flashModels, listModels } from "./models";

describe("listModels", () => {
  it("sends the key as a header, follows pages, and keeps only text Flash models", async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const pages = [
      { models: [{ name: "models/gemini-3.5-flash-lite", version: "v", displayName: "L", supportedGenerationMethods: ["generateContent"] }, { name: "models/gemini-3.5-flash-tts", supportedGenerationMethods: ["generateContent"] }], nextPageToken: "p2" },
      { models: [{ name: "models/gemini-3.8-flash", version: "3.0", displayName: "F", supportedGenerationMethods: ["generateContent"] }, { name: "models/embed-flash", supportedGenerationMethods: ["embedContent"] }] },
    ];
    const fakeFetch = async (url: string, init: { headers: Record<string, string> }) => {
      calls.push({ url, headers: init.headers });
      return { ok: true, status: 200, json: async () => pages[calls.length - 1] };
    };
    const models = await listModels("SECRET", fakeFetch);
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => !c.url.includes("SECRET") && c.headers["x-goog-api-key"] === "SECRET")).toBe(true);
    expect(flashModels(models).map((m) => m.name)).toEqual(["gemini-3.5-flash-lite", "gemini-3.8-flash"]);
  });

  it("reports an HTTP error without echoing the key", async () => {
    await expect(listModels("SECRET", async () => ({ ok: false, status: 403, json: async () => ({}) }))).rejects.toThrow("HTTP 403");
  });
});
