import { describe, expect, it } from "vitest";
import { jsonResponse, toJsonText } from "./json";

const BACKSLASH = String.fromCharCode(0x5c);
const cp = (...codes: number[]) => String.fromCodePoint(...codes);
const hex4 = (n: number) => n.toString(16).padStart(4, "0");
const esc = (n: number) => `${BACKSLASH}u${hex4(n)}`;

describe("jsonResponse (J1)", () => {
  const bmp = [0x202e, 0x2028, 0x2029, 0x200e, 0x200f, 0x202a, 0x2066, 0x2069, 0xfeff];
  const quote = `pay${cp(0x202e)}evil${cp(0x2028)}next${cp(0x2029, 0x200e, 0x200f, 0x202a, 0x2066, 0x2069, 0xfeff)}end, plain text kept`;

  it("escapes bidi controls and line separators on the wire but parses back to the same string", async () => {
    const res = jsonResponse({ quote });
    const raw = await res.text();
    expect(raw).toContain(esc(0x202e));
    expect(raw).toContain(esc(0x2028));
    expect(raw).toContain(esc(0xfeff));
    for (const code of bmp) expect(raw.includes(String.fromCharCode(code))).toBe(false);
    expect(JSON.parse(raw).quote).toBe(quote);
  });

  it("escapes every code point of each added range and round-trips it", () => {
    const ranges: [string, number, number][] = [
      ["arabic letter mark", 0x061c, 0x061c],
      ["zero-width", 0x200b, 0x200d],
      ["word joiner and invisible operators", 0x2060, 0x2064],
      ["soft hyphen", 0x00ad, 0x00ad],
      ["bidi isolates", 0x2066, 0x2069],
    ];
    for (const [name, a, b] of ranges) {
      for (let c = a; c <= b; c++) {
        const text = toJsonText({ q: `a${cp(c)}b` });
        expect(text, `${name} U+${c.toString(16)}`).toBe(`{"q":"a${esc(c)}b"}`);
        expect(JSON.parse(text).q).toBe(`a${cp(c)}b`);
      }
    }
  });

  it("escapes tag characters U+E0000 to U+E007F as surrogate pairs and keeps the parsed text verbatim", () => {
    for (const c of [0xe0000, 0xe0001, 0xe0041, 0xe007f]) {
      const text = toJsonText({ q: `x${cp(c)}y` });
      const v = c - 0x10000;
      expect(text).toBe(`{"q":"x${esc(0xd800 + (v >> 10))}${esc(0xdc00 + (v & 0x3ff))}y"}`);
      expect(JSON.parse(text).q).toBe(`x${cp(c)}y`);
    }
    const hidden = Array.from({ length: 0x80 }, (_, i) => cp(0xe0000 + i)).join("");
    const raw = toJsonText({ q: `ignore${hidden}` });
    expect(Array.from(raw).some((ch) => (ch.codePointAt(0) as number) >= 0xe0000)).toBe(false);
    expect(JSON.parse(raw).q).toBe(`ignore${hidden}`);
  });

  it("leaves ordinary text, emoji, and the characters next to the ranges alone", () => {
    const plain = `caf${cp(0xe9)} ${cp(0x2013)} ${cp(0x1f600)} ${cp(0x00ac, 0x00ae, 0x200a, 0x2010, 0x2065, 0x206a, 0xe0080, 0xdfff0 & 0xfffff)}`;
    expect(toJsonText({ a: plain })).toBe(JSON.stringify({ a: plain }));
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
