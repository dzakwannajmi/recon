import { afterEach, describe, expect, it, vi } from "vitest";
import { ttlCache } from "./cache";

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
});
