import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runAgent = vi.fn(async (..._args: unknown[]) => ({ answer: "ok", steps: [] }));
vi.mock("@/agent/agent", () => ({ runAgent, MODEL: "x" }));
vi.mock("@/agent/tools", () => ({ tools: [{ name: "t", description: "d" }] }));
vi.mock("@/agent/wallet", () => ({ WalletError: class WalletError extends Error {} }));

const KEYS = { GEMINI_API_KEY: "g-secret", GROQ_API_KEY: "q-secret", OPENROUTER_API_KEY: "o-secret" };

/** llm.ts and models.ts read env at import time, so each test loads fresh copies. */
async function load(env: Record<string, string> = {}) {
  vi.resetModules();
  for (const k of ["LLM_PROVIDER", "LLM_MODEL", "GEMINI_API_KEY", "GROQ_API_KEY", "OPENROUTER_API_KEY", "VERCEL", "TRUST_PROXY"]) vi.stubEnv(k, "");
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  return { models: await import("./models"), route: await import("@/app/api/agent/route") };
}

const post = (body: unknown, ip = "1.1.1.1") =>
  new Request("http://localhost/api/agent", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
const messages = [{ role: "user", text: "hi" }];

beforeEach(() => runAgent.mockClear());
afterEach(() => vi.unstubAllEnvs());

describe("chat model allowlist", () => {
  it("offers only entries whose provider has a key", async () => {
    const { models } = await load({ GEMINI_API_KEY: "g", LLM_PROVIDER: "google", LLM_MODEL: "gemini-flash-lite-latest" });
    expect(models.availableChatModels().map((m) => m.id)).toEqual(["gemini-flash-lite", "gemini-flash"]);
    const all = await load({ ...KEYS, LLM_PROVIDER: "google", LLM_MODEL: "gemini-flash-lite-latest" });
    expect(all.models.availableChatModels().map((m) => m.id)).toEqual(["gemini-flash-lite", "gemini-flash", "gpt-oss-120b", "nemotron-3-super"]);
  });

  it("keeps the default from the environment, first in the list", async () => {
    const { models } = await load({ ...KEYS, LLM_PROVIDER: "groq", LLM_MODEL: "openai/gpt-oss-120b" });
    const list = models.availableChatModels();
    expect(list[0]).toMatchObject({ id: "gpt-oss-120b", provider: "groq", model: "openai/gpt-oss-120b", default: true });
    expect(list.filter((m) => m.default)).toHaveLength(1);
    expect(list.filter((m) => m.model === "openai/gpt-oss-120b")).toHaveLength(1);
  });

  it("makes an env pair outside the allowlist the default entry, unchanged", async () => {
    const { models } = await load({ ...KEYS, LLM_PROVIDER: "google", LLM_MODEL: "gemini-3.7-flash" });
    expect(models.resolveChatModel(undefined)).toMatchObject({ id: "default", provider: "google", model: "gemini-3.7-flash", default: true });
  });

  it("falls back to the env default when no id is sent (current behavior)", async () => {
    const { models } = await load({ GEMINI_API_KEY: "g" });
    expect(models.resolveChatModel(undefined)).toMatchObject({ provider: "google", model: "gemini-flash-latest" });
  });

  it("rejects unknown, unavailable, empty and non-string ids", async () => {
    const { models } = await load({ GEMINI_API_KEY: "g" });
    for (const id of ["gpt-4", "openai/gpt-oss-120b", "gemini-flash-lite-latest", "", "__proto__", 7, {}, ["gemini-flash"]]) {
      expect(models.resolveChatModel(id)).toBeNull();
    }
    expect(models.resolveChatModel("gpt-oss-120b")).toBeNull(); // known, but no Groq key
  });
});

describe("POST /api/agent model choice", () => {
  it("passes the allowlist entry, not the client text, to the agent", async () => {
    const { route } = await load({ ...KEYS, LLM_PROVIDER: "google", LLM_MODEL: "gemini-flash-lite-latest" });
    const res = await route.POST(post({ messages, model: "gpt-oss-120b" }));
    expect(res.status).toBe(200);
    expect(runAgent).toHaveBeenCalledTimes(1);
    expect(runAgent.mock.calls[0][1]).toMatchObject({ provider: "groq", model: "openai/gpt-oss-120b" });
  });

  it("returns 400 and never calls the agent for an unknown or unavailable id", async () => {
    const { route } = await load({ GEMINI_API_KEY: "g" });
    for (const [i, model] of ["evil/model", "gpt-oss-120b", "", 5].entries()) {
      const res = await route.POST(post({ messages, model }, `2.2.2.${i}`));
      expect(res.status).toBe(400);
      const text = JSON.stringify(await res.json());
      expect(text).not.toMatch(/evil|GROQ|secret/);
    }
    expect(runAgent).not.toHaveBeenCalled();
  });

  it("uses the env default when no model is sent", async () => {
    const { route } = await load({ GEMINI_API_KEY: "g", LLM_PROVIDER: "google", LLM_MODEL: "gemini-flash-lite-latest" });
    expect((await route.POST(post({ messages }))).status).toBe(200);
    expect(runAgent.mock.calls[0][1]).toMatchObject({ provider: "google", model: "gemini-flash-lite-latest", default: true });
  });

  it("keeps the existing setup error when the default provider has no key", async () => {
    const { route } = await load({ LLM_PROVIDER: "google" });
    const res = await route.POST(post({ messages }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("GEMINI_API_KEY");
    expect(runAgent).not.toHaveBeenCalled();
  });

  it("still applies the per-IP rate limit to a chosen model", async () => {
    const { route } = await load({ GEMINI_API_KEY: "g", GROQ_API_KEY: "q", TRUST_PROXY: "true" });
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await route.POST(post({ messages, model: "gpt-oss-120b" }, "9.9.9.9"))).status);
    expect(codes).toContain(429);
  });
});

describe("GET /api/agent models", () => {
  it("lists id, label, note and default, with no keys, providers, model strings or env names", async () => {
    const { route } = await load({ ...KEYS, LLM_PROVIDER: "google", LLM_MODEL: "gemini-flash-lite-latest" });
    const data = await (await route.GET()).json();
    expect(data.models).toEqual([
      { id: "gemini-flash-lite", label: "Gemini Flash-Lite", note: null, default: true },
      { id: "gemini-flash", label: "Gemini Flash", note: null, default: false },
      { id: "gpt-oss-120b", label: "GPT-OSS 120B", note: "not benchmarked for chat", default: false },
      { id: "nemotron-3-super", label: "Nemotron 3 Super", note: "not benchmarked for chat", default: false },
    ]);
    const text = JSON.stringify(data.models);
    expect(text).not.toMatch(/secret|API_KEY|openrouter|groq|google|openai\/|nvidia\//);
    expect(JSON.stringify(data)).not.toMatch(/-secret/);
  });
});
