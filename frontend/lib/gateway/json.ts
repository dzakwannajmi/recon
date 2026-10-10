/**
 * JSON responses for the check routes (spec 6.3). The parsed value is identical to the input
 * (quotes stay verbatim), but invisible and direction-changing characters never travel as raw
 * bytes: they leave as JSON unicode escapes (astral ones as surrogate pairs). Output is JSON only, never HTML.
 */
import { NextResponse } from "next/server";
import { escapeInvisible } from "./text";

/** `JSON.stringify` with bigint values as numbers (when safe) or strings, and the characters above escaped. */
export function toJsonText(body: unknown): string {
  const text = JSON.stringify(body, (_key, value: unknown) => {
    if (typeof value !== "bigint") return value;
    return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= -BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString();
  });
  return escapeInvisible(text);
}

export function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): NextResponse {
  return jsonTextResponse(toJsonText(body), init);
}

/** A response from text that `toJsonText` already produced. */
export function jsonTextResponse(text: string, init: { status?: number; headers?: Record<string, string> } = {}): NextResponse {
  return new NextResponse(text, {
    status: init.status ?? 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      ...init.headers,
    },
  });
}
