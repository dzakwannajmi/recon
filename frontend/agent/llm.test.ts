import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A model call that succeeds but reports no usage (the step hook gets an empty usage object).
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateText: vi.fn(async (opts: { onStepEnd?: (e: unknown) => void }) => {
    opts.onStepEnd?.({ usage: {}, finishReason: "stop" });
    return { text: "ok", output: { claims: [] }, totalUsage: {}, response: {} };
  }),
}));

/** llm.ts reads its env and cwd at import time, so each test imports a fresh copy. */
async function load(env: Record<string, string | undefined> = {}) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) vi.stubEnv(k, "");
    else vi.stubEnv(k, v);
  }
  return import("./llm");
}

describe("providers and keys", () => {
  beforeEach(() => {
    for (const k of ["LLM_PROVIDER", "LLM_EXTRACT_PROVIDER", "VERCEL"]) vi.stubEnv(k, "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("maps each provider to its own key variable", async () => {
    const llm = await load({ GEMINI_API_KEY: "g", GROQ_API_KEY: "", OPENROUTER_API_KEY: "o" });
    expect(llm.hasApiKey("google")).toBe(true);
    expect(llm.hasApiKey("groq")).toBe(false);
    expect(llm.hasApiKey("openrouter")).toBe(true);
    expect(llm.hasApiKey("nope")).toBe(false);
  });

  it("builds a model for each provider and names the env var, not the value, when a key is missing", async () => {
    const llm = await load({ GEMINI_API_KEY: "g-secret", GROQ_API_KEY: "q-secret", OPENROUTER_API_KEY: "" });
    expect(llm.languageModel("google", "gemini-x").provider).toContain("google");
    expect(llm.languageModel("groq", "openai/gpt-oss-120b").provider).toContain("groq");
    expect(() => llm.languageModel("openrouter", "m")).toThrow("OPENROUTER_API_KEY is not set");
    expect(() => llm.languageModel("groq", "m")).not.toThrow();
    try {
      llm.languageModel("openrouter", "m");
    } catch (err) {
      expect((err as Error).message).not.toMatch(/secret/);
    }
  });

  it("builds an openrouter model that reports its provider name as openrouter", async () => {
    const llm = await load({ OPENROUTER_API_KEY: "o" });
    expect(llm.languageModel("openrouter", "nvidia/nemotron-3-super-120b-a12b:free").provider).toBe("openrouter.chat");
  });

  it("throws on an unknown provider", async () => {
    const llm = await load();
    expect(() => llm.languageModel("nope", "m")).toThrow(/provider "nope" is not set up/);
    expect(() => llm.usageFile("nope")).toThrow(/provider "nope"/);
  });

  it("EXTRACT_PROVIDER follows LLM_EXTRACT_PROVIDER, then LLM_PROVIDER, then google", async () => {
    expect((await load()).EXTRACT_PROVIDER).toBe("google");
    expect((await load({ LLM_PROVIDER: "groq" })).EXTRACT_PROVIDER).toBe("groq");
    expect((await load({ LLM_PROVIDER: "groq", LLM_EXTRACT_PROVIDER: "openrouter" })).EXTRACT_PROVIDER).toBe("openrouter");
  });

  it("EXTRACT_MODEL defaults to the W2.6 pick on google, with its thinking level only while that model is in use", async () => {
    const pick = await load({ LLM_MODEL: "gemini-flash-lite-latest", LLM_EXTRACT_MODEL: "" });
    expect(pick.EXTRACT_MODEL).toBe("gemini-3.7-flash");
    expect(pick.EXTRACT_PROVIDER_OPTIONS).toEqual({ google: { thinkingConfig: { thinkingLevel: "low" } } });
    const override = await load({ LLM_EXTRACT_MODEL: "gemini-flash-lite-latest" });
    expect(override.EXTRACT_MODEL).toBe("gemini-flash-lite-latest");
    expect(override.EXTRACT_PROVIDER_OPTIONS).toBeUndefined();
    const groq = await load({ LLM_PROVIDER: "groq", LLM_MODEL: "openai/gpt-oss-120b", LLM_EXTRACT_MODEL: "" });
    expect(groq.EXTRACT_MODEL).toBe("openai/gpt-oss-120b");
    expect(groq.EXTRACT_PROVIDER_OPTIONS).toBeUndefined();
  });

  it("assertExtractConfig throws when extraction is on another provider without LLM_EXTRACT_MODEL", async () => {
    await expect(load({ LLM_PROVIDER: "google", LLM_EXTRACT_PROVIDER: "groq", LLM_EXTRACT_MODEL: "" }).then((l) => l.assertExtractConfig())).rejects.toThrow(/LLM_EXTRACT_MODEL must be set/);
    await expect(load({ LLM_PROVIDER: "google", LLM_EXTRACT_PROVIDER: "groq", LLM_EXTRACT_MODEL: "openai/gpt-oss-120b" }).then((l) => l.assertExtractConfig())).resolves.toBeUndefined();
    await expect(load({ LLM_PROVIDER: "google", LLM_EXTRACT_PROVIDER: "", LLM_EXTRACT_MODEL: "" }).then((l) => l.assertExtractConfig())).resolves.toBeUndefined();
  });

  it("apiKeyEnvName gives env var names only", async () => {
    const llm = await load({ GEMINI_API_KEY: "secret-g" });
    expect(llm.apiKeyEnvName("google")).toBe("GEMINI_API_KEY");
    expect(llm.apiKeyEnvName("groq")).toBe("GROQ_API_KEY");
    expect(llm.apiKeyEnvName("openrouter")).toBe("OPENROUTER_API_KEY");
    expect(llm.apiKeyEnvName("nope")).toBeNull();
  });

  it("generateStructured needs a model when the provider differs from EXTRACT_PROVIDER, before any call", async () => {
    const llm = await load();
    await expect(llm.generateStructured({ instructions: "i", prompt: "p", schema: {} as never, provider: "groq" })).rejects.toThrow(/model is required/);
  });
});

describe("per-provider daily usage", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "llm-usage-test-"));
    vi.spyOn(process, "cwd").mockReturnValue(dir);
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("LLM_DAILY_TOKEN_BUDGET", "1000");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const today = () => new Date().toISOString().slice(0, 10);
  const write = (file: string, tokens: number, day = today()) => {
    fs.mkdirSync(path.join(dir, ".cache"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".cache", file), JSON.stringify({ day, tokens }));
  };

  it("keeps google on llm-usage.json and gives the others their own files", async () => {
    const llm = await load();
    expect(path.relative(dir, llm.usageFile("google"))).toBe(path.join(".cache", "llm-usage.json"));
    expect(path.relative(dir, llm.usageFile("groq"))).toBe(path.join(".cache", "llm-usage-groq.json"));
    expect(path.relative(dir, llm.usageFile("openrouter"))).toBe(path.join(".cache", "llm-usage-openrouter.json"));
  });

  it("counts each provider separately and keeps today's google count", async () => {
    write("llm-usage.json", 400);
    write("llm-usage-groq.json", 900);
    const llm = await load();
    expect(llm.budgetLeft("google")).toBe(600);
    expect(llm.budgetLeft("groq")).toBe(100);
    expect(llm.budgetLeft("openrouter")).toBe(1000); // no file yet
    expect(llm.budgetLeft()).toBe(600); // default is the chat provider (google)
  });

  it("starts a new day at zero, and fails closed for the provider whose file is unreadable", async () => {
    write("llm-usage.json", 400, "2000-01-01");
    fs.writeFileSync(path.join(dir, ".cache", "llm-usage-groq.json"), "not json");
    const llm = await load();
    expect(llm.budgetLeft("google")).toBe(1000);
    expect(llm.budgetLeft("groq")).toBe(0);
    expect(llm.budgetLeft("google")).toBe(1000); // groq trouble does not close google
  });

  it("fails closed for a provider whose successful call reports no usage, and only for that provider", async () => {
    vi.stubEnv("GROQ_API_KEY", "q");
    vi.stubEnv("GEMINI_API_KEY", "g");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const schema = z.object({ claims: z.array(z.unknown()) });
    const llm = await load();
    expect(llm.budgetLeft("groq")).toBe(1000);
    await llm.generateStructured({ instructions: "i", prompt: "p", schema, provider: "groq", model: "m" });
    expect(llm.budgetLeft("groq")).toBe(0);
    expect(llm.budgetLeft("google")).toBe(1000);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('"groq"'));
    // The next call for groq is refused before it starts.
    await expect(llm.generateStructured({ instructions: "i", prompt: "p", schema, provider: "groq", model: "m" })).rejects.toThrow(/budget is used up/);
  });

  it("does the same in the chat step hook", async () => {
    vi.stubEnv("GEMINI_API_KEY", "g");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const llm = await load();
    await llm.generateWithTools({ instructions: "i", messages: [], tools: [] });
    expect(llm.budgetLeft("google")).toBe(0);
    expect(llm.budgetLeft("groq")).toBe(1000);
  });
});
