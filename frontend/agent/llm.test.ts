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

  it("gates a chat call on the chosen provider's budget, not the default's", async () => {
    write("llm-usage-groq.json", 1000);
    const llm = await load();
    await expect(
      llm.generateWithTools({ instructions: "i", messages: [], tools: [], chat: { provider: "groq", model: "openai/gpt-oss-120b" } }),
    ).rejects.toBeInstanceOf(llm.BudgetExceededError);
    expect(llm.budgetLeft("google")).toBe(1000); // the default provider is untouched
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

describe("provider request limits (chat)", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "llm-requests-test-"));
    vi.spyOn(process, "cwd").mockReturnValue(dir);
    for (const k of ["VERCEL", "LLM_DAILY_REQUEST_BUDGET", "LLM_MINUTE_REQUEST_BUDGET"]) vi.stubEnv(k, "");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const day = () => new Date().toISOString().slice(0, 10);
  const file = (name: string) => path.join(dir, ".cache", name);
  const writeRequests = (name: string, count: number, recent: number[] = [], d = day()) => {
    fs.mkdirSync(path.join(dir, ".cache"), { recursive: true });
    fs.writeFileSync(file(name), JSON.stringify({ day: d, count, recent }));
  };

  it("defaults to a conservative limit for google only, and lets the environment set one for every provider", async () => {
    const llm = await load();
    expect(llm.requestLimits("google")).toEqual({ day: 18, minute: 4 });
    expect(llm.requestLimits("groq")).toEqual({ day: null, minute: null });
    expect(llm.requestLimits("openrouter")).toEqual({ day: null, minute: null });
    const set = await load({ LLM_DAILY_REQUEST_BUDGET: "7", LLM_MINUTE_REQUEST_BUDGET: "2" });
    expect(set.requestLimits("google")).toEqual({ day: 7, minute: 2 });
    expect(set.requestLimits("groq")).toEqual({ day: 7, minute: 2 });
    // A typo falls back to the default; it cannot switch google's limit off.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const typo = await load({ LLM_DAILY_REQUEST_BUDGET: "20/day" });
    expect(typo.requestLimits("google").day).toBe(18);
    expect(typo.requestLimits("groq").day).toBeNull();
  });

  it("counts a request per call and refuses at the minute limit, then frees up as the minute passes", async () => {
    const llm = await load();
    const t0 = 1_000_000_000_000;
    for (let i = 0; i < 4; i++) llm.takeRequest("google", { now: t0 + i * 1000 });
    expect(JSON.parse(fs.readFileSync(file("llm-requests.json"), "utf8")).count).toBe(4);
    try {
      llm.takeRequest("google", { now: t0 + 10_000 });
      throw new Error("should have been refused");
    } catch (err) {
      expect(err).toBeInstanceOf(llm.RequestLimitError);
      expect((err as Error).message).toBe("This model's request limit is reached. Pick another model or try later.");
      expect((err as InstanceType<typeof llm.RequestLimitError>).retryAfterSeconds).toBe(50); // the oldest leaves the window at t0 + 60s, now is t0 + 10s
    }
    expect(JSON.parse(fs.readFileSync(file("llm-requests.json"), "utf8")).count).toBe(4); // a refusal is not counted
    expect(() => llm.takeRequest("google", { now: t0 + 61_000 })).not.toThrow(); // the first request is more than a minute old
  });

  it("refuses at the daily limit until the UTC day changes, without touching other providers", async () => {
    writeRequests("llm-requests.json", 18);
    const llm = await load();
    expect(() => llm.takeRequest("google")).toThrow(llm.RequestLimitError);
    expect(() => llm.takeRequest("groq")).not.toThrow(); // no limit set for groq
    expect(fs.existsSync(file("llm-requests-groq.json"))).toBe(false);
    writeRequests("llm-requests.json", 18, [], "2000-01-01");
    expect(() => llm.takeRequest("google")).not.toThrow();
  });

  it("keeps a separate count per provider when the environment limits them", async () => {
    const llm = await load({ LLM_MINUTE_REQUEST_BUDGET: "1" });
    llm.takeRequest("google");
    llm.takeRequest("groq");
    expect(() => llm.takeRequest("google")).toThrow(llm.RequestLimitError);
    expect(() => llm.takeRequest("groq")).toThrow(llm.RequestLimitError);
    expect(fs.existsSync(file("llm-requests.json"))).toBe(true);
    expect(fs.existsSync(file("llm-requests-groq.json"))).toBe(true);
  });

  it("fails closed when the count cannot be read, and only for that provider", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fs.mkdirSync(path.join(dir, ".cache"), { recursive: true });
    fs.writeFileSync(file("llm-requests.json"), "not json");
    const llm = await load();
    expect(() => llm.takeRequest("google")).toThrow(llm.RequestLimitError);
    writeRequests("llm-requests.json", 0); // even a repaired file stays blocked until the server restarts
    expect(() => llm.takeRequest("google")).toThrow(llm.RequestLimitError);
    const other = await load({ LLM_DAILY_REQUEST_BUDGET: "5" });
    expect(() => other.takeRequest("groq")).not.toThrow();
  });

  it("fails closed when the count cannot be saved", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fs.mkdirSync(path.join(dir, ".cache"));
    fs.mkdirSync(file("llm-requests.json")); // a directory where the file should be: reads and writes fail
    const llm = await load();
    expect(() => llm.takeRequest("google")).toThrow(llm.RequestLimitError);
  });

  it("refuses a chat call before any provider call when the allowance is gone", async () => {
    writeRequests("llm-requests.json", 18);
    const llm = await load();
    const ai = await import("ai");
    await expect(llm.generateWithTools({ instructions: "i", messages: [], tools: [] })).rejects.toBeInstanceOf(llm.RequestLimitError);
    expect(ai.generateText).not.toHaveBeenCalled();
  });

  it("counts every provider request the wrapped model sends (each step and each retry), and sends none once the limit is reached", async () => {
    const llm = await load({ LLM_MINUTE_REQUEST_BUDGET: "2", LLM_DAILY_REQUEST_BUDGET: "50" });
    const doGenerate = vi.fn(async () => ({ content: [], finishReason: "stop", usage: {}, warnings: [] }));
    const fake = { specificationVersion: "v3", provider: "google.generative-ai", modelId: "m", supportedUrls: {}, doGenerate, doStream: vi.fn() };
    const model = llm.withRequestCount(fake as never, "google");
    await model.doGenerate({ prompt: [] } as never);
    await model.doGenerate({ prompt: [] } as never);
    await expect(model.doGenerate({ prompt: [] } as never)).rejects.toBeInstanceOf(llm.RequestLimitError);
    expect(doGenerate).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fs.readFileSync(file("llm-requests.json"), "utf8")).count).toBe(2);
  });
});
