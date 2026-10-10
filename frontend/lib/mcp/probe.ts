/**
 * Pure helpers of the probe CLI (scripts/mcp-probe.ts, spec 10.1): argument parsing, the URL rule,
 * and the recording of exchanges. No network, no file access, no client library.
 */

export type Era = "legacy" | "modern";
export type ProbeArgs = { help: boolean; url: string; eras: Era[]; out: string | null };

export const DEFAULT_URL = "http://localhost:3000/api/mcp";

export const USAGE = `Usage: npm run mcp:probe -- [--url URL] [--era legacy|modern|both] [--out DIR]

Calls the MCP endpoint with the official client and checks the three tools.
  --url URL    the endpoint (default ${DEFAULT_URL}); http://localhost:*, http://127.0.0.1:* or https://... only
  --era ERA    legacy (2025 handshake), modern (2026-07-28) or both (default)
  --out DIR    write DIR/probe-<era>.json with every exchange
Exit code 0 when every expectation holds, 1 otherwise. It reads no .env file and holds no secret.`;

/** The URL, or null when it is not an endpoint the probe may call. */
export function validateProbeUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.username || u.password) return null;
  if (u.protocol === "https:") return u.href;
  if (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1")) return u.href;
  return null;
}

/** Parses the flags; throws an Error with a fixed sentence on a bad one. */
export function parseProbeArgs(argv: readonly string[]): ProbeArgs {
  const out: ProbeArgs = { help: false, url: DEFAULT_URL, eras: ["legacy", "modern"], out: null };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--help" || flag === "-h") {
      out.help = true;
      continue;
    }
    const value = argv[i + 1];
    if (flag === "--url" || flag === "--era" || flag === "--out") {
      if (value === undefined || value.startsWith("--")) throw new Error(`${flag} needs a value`);
      i++;
      if (flag === "--url") {
        const ok = validateProbeUrl(value);
        if (!ok) throw new Error("--url must be http://localhost:*, http://127.0.0.1:*, or https://...");
        out.url = ok;
      } else if (flag === "--era") {
        if (value === "both") out.eras = ["legacy", "modern"];
        else if (value === "legacy" || value === "modern") out.eras = [value];
        else throw new Error("--era must be legacy, modern, or both");
      } else out.out = value;
      continue;
    }
    throw new Error(`Unknown argument ${JSON.stringify(flag).slice(0, 40)}`);
  }
  return out;
}

/** The JSON values of the `data:` lines of an event stream. A line that is not JSON is skipped. */
export function parseSse(text: string): unknown[] {
  const out: unknown[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    try {
      out.push(JSON.parse(line.slice(5).trim()));
    } catch {
      // not JSON: skipped
    }
  }
  return out;
}

/** A body as recorded: JSON parsed, an event stream as its parsed `data` values, anything else as text. */
export function recordBody(text: string, contentType: string | null): unknown {
  if (text === "") return null;
  const type = (contentType ?? "").toLowerCase();
  if (type.startsWith("text/event-stream")) return parseSse(text);
  try {
    return JSON.parse(text);
  } catch {
    return text.slice(0, 2000);
  }
}

export type Exchange = {
  seq: number;
  at: string;
  request: { method: string; url: string; headers: Record<string, string | null>; body: unknown };
  response: { status: number; headers: Record<string, string | null>; body: unknown };
};

const REQUEST_HEADERS = ["content-type", "accept", "mcp-protocol-version", "mcp-method", "mcp-name"] as const;

export function pick(headers: Headers, names: readonly string[]): Record<string, string | null> {
  return Object.fromEntries(names.map((n) => [n, headers.get(n)]));
}

/** A fetch that records every exchange. Only the listed headers are kept. */
export function recordingFetch(fetchImpl: typeof fetch, exchanges: Exchange[], now: () => Date = () => new Date()): typeof fetch {
  return async (input, init) => {
    const req = new Request(input, init);
    const at = now().toISOString();
    const reqText = await req.clone().text();
    const res = await fetchImpl(req);
    const resText = await res.clone().text();
    exchanges.push({
      seq: exchanges.length + 1,
      at,
      request: { method: req.method, url: req.url, headers: pick(req.headers, REQUEST_HEADERS), body: recordBody(reqText, req.headers.get("content-type")) },
      response: { status: res.status, headers: pick(res.headers, ["content-type"]), body: recordBody(resText, res.headers.get("content-type")) },
    });
    return res;
  };
}
