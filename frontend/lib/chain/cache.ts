/**
 * A small in-memory TTL cache for network reads, so repeated chat questions
 * about the same issuer don't hit Horizon or issuer domains every time.
 * Concurrent callers for the same key share one request; failures are not cached.
 */
export function ttlCache<T>(ttlMs: number, maxEntries = 500) {
  const entries = new Map<string, { at: number; value: Promise<T> }>();

  return {
    get(key: string, load: () => Promise<T>): Promise<T> {
      const hit = entries.get(key);
      if (hit && Date.now() - hit.at < ttlMs) return hit.value;

      const value = load();
      entries.delete(key);
      entries.set(key, { at: Date.now(), value });
      value.catch(() => {
        if (entries.get(key)?.value === value) entries.delete(key);
      });
      if (entries.size > maxEntries) entries.delete(entries.keys().next().value!);
      return value;
    },
    clear() {
      entries.clear();
    },
  };
}
