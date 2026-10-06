import { afterEach, describe, expect, it, vi } from "vitest";
import { abortable, ttlCache } from "./cache";

describe("ttlCache", () => {
  afterEach(() => vi.useRealTimers());

  it("shares one load between concurrent callers and reuses it within the TTL", async () => {
    const cache = ttlCache<number>(1000);
    const load = vi.fn(async () => 7);
    await expect(Promise.all([cache.get("k", load), cache.get("k", load)])).resolves.toEqual([7, 7]);
    await cache.get("k", load);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("reloads after the TTL", async () => {
    vi.useFakeTimers();
    const cache = ttlCache<number>(1000);
    const load = vi.fn(async () => 1);
    await cache.get("k", load);
    vi.advanceTimersByTime(1001);
    await cache.get("k", load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("does not cache failures", async () => {
    const cache = ttlCache<number>(1000);
    await expect(cache.get("k", async () => Promise.reject(new Error("down")))).rejects.toThrow("down");
    await expect(cache.get("k", async () => 2)).resolves.toBe(2);
  });

  it("evicts the oldest entry past the size limit", async () => {
    const cache = ttlCache<number>(1000, 2);
    const load = vi.fn(async () => 0);
    await cache.get("a", load);
    await cache.get("b", load);
    await cache.get("c", load);
    await cache.get("a", load);
    expect(load).toHaveBeenCalledTimes(4);
  });

  it("uses a value-dependent TTL", async () => {
    vi.useFakeTimers();
    const cache = ttlCache<string>((v) => (v === "degraded" ? 100 : 1000));
    const load = vi.fn(async () => "degraded");
    await cache.get("k", load);
    vi.advanceTimersByTime(101);
    await cache.get("k", load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("lets one caller stop waiting without affecting others", async () => {
    const cache = ttlCache<number>(1000);
    let finish!: (v: number) => void;
    const load = vi.fn(() => new Promise<number>((resolve) => (finish = resolve)));
    const controller = new AbortController();
    const a = cache.get("k", load, controller.signal);
    const b = cache.get("k", load);
    controller.abort();
    await expect(a).rejects.toMatchObject({ name: "AbortError" });
    finish(5);
    await expect(b).resolves.toBe(5);
    await expect(cache.get("k", load)).resolves.toBe(5);
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe("abortable", () => {
  it("rejects immediately for an already-aborted signal", async () => {
    await expect(abortable(Promise.resolve(1), AbortSignal.abort())).rejects.toMatchObject({ name: "AbortError" });
  });

  it("passes the value through when the signal never fires", async () => {
    await expect(abortable(Promise.resolve(1), new AbortController().signal)).resolves.toBe(1);
  });
});
