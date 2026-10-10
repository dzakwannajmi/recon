import { describe, expect, it } from "vitest";
import { jsonResponse, toJsonText } from "./json";

const chars = (...codes: number[]) => codes.map((c) => String.fromCharCode(c)).join("");
const BACKSLASH = String.fromCharCode(0x5c);

describe("jsonResponse (J1)", () => {
  const escaped = [0x202e, 0x2028, 0x2029, 0x200e, 0x200f, 0x202a, 0x2066, 0x2069, 0xfeff];
  const quote = `pay${chars(0x202e)}evil${chars(0x2028)}next${chars(0x2029, 0x200e, 0x200f, 0x202a, 0x2066, 0x2069, 0xfeff)}end, plain text kept`;

  it("escapes bidi controls and line separators on the wire but parses back to the same string", async () => {
    const res = jsonResponse({ quote });
    const raw = await res.text();
    expect(raw).toContain(`${BACKSLASH}u202e`);
    expect(raw).toContain(`${BACKSLASH}u2028`);
    expect(raw).toContain(`${BACKSLASH}ufeff`);
    for (const code of escaped) expect(raw.includes(String.fromCharCode(code))).toBe(false);
    expect(JSON.parse(raw).quote).toBe(quote);
  });

  it("leaves ordinary text and non-ASCII letters alone", () => {
    expect(toJsonText({ a: "café – ok" })).toBe(JSON.stringify({ a: "café – ok" }));
  });

  it("sets the JSON content type, nosniff, the status and extra headers", () => {
    const res = jsonResponse({ ok: true }, { status: 404, headers: { "Cache-Control": "no-store" } });
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("writes bigint as a number when safe and as a string otherwise", () => {
    expect(toJsonText({ a: 5n, b: 9007199254740993n })).toBe('{"a":5,"b":"9007199254740993"}');
  });
});
