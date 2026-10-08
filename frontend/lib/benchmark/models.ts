/**
 * List the Gemini models the API key can use (names, versions, display names
 * only), so the benchmark configs can pin versioned model IDs. The key goes in
 * the `x-goog-api-key` header, never in the URL, and is never printed.
 */
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

export type ModelInfo = { name: string; version: string; displayName: string; methods: string[] };

type FetchLike = (url: string, init: { headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export async function listModels(apiKey: string, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<ModelInfo[]> {
  const models: ModelInfo[] = [];
  let pageToken = "";
  for (let page = 0; page < 20; page++) {
    const url = `${ENDPOINT}?pageSize=200${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
    const res = await fetchImpl(url, { headers: { "x-goog-api-key": apiKey } });
    if (!res.ok) throw new Error(`Model list failed: HTTP ${res.status}`);
    const body = (await res.json()) as { models?: Record<string, unknown>[]; nextPageToken?: string };
    for (const m of body.models ?? []) {
      models.push({
        name: String(m.name ?? "").replace(/^models\//, ""),
        version: String(m.version ?? ""),
        displayName: String(m.displayName ?? ""),
        methods: Array.isArray(m.supportedGenerationMethods) ? m.supportedGenerationMethods.map(String) : [],
      });
    }
    if (!body.nextPageToken) break;
    pageToken = body.nextPageToken;
  }
  return models;
}

/** Text-generation Flash and Flash-Lite models, sorted by name. */
export const flashModels = (models: ModelInfo[]) =>
  models.filter((m) => /flash/i.test(m.name) && m.methods.includes("generateContent") && !/image|tts|audio|live|embedding/i.test(m.name)).sort((a, b) => a.name.localeCompare(b.name));
