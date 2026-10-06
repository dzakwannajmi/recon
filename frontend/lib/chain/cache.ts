/**
 * A small in-memory TTL cache for network reads, so repeated chat questions
 * about the same issuer don't hit Horizon or issuer domains every time.
 *
 * - Concurrent callers for the same key share one load. The load must not use
 *   any caller's abort signal (it has its own deadlines); each caller instead
 *   stops waiting when its own signal aborts, without affecting the others.
 * - Failures are not cached. The TTL can depend on the value, so degraded
 *   results (e.g. an unreachable toml) can expire sooner.
 */
export function ttlCache<T>(ttl: number | ((value: T) => number), maxEntries = 500) {
  const entries = new Map<string, { expires: number; value: Promise<T> }>();
  const ttlOf = typeof ttl === "function" ? ttl : () => ttl;

  return {
    get(key: string, load: () => Promise<T>, signal?: AbortSignal): Promise<T> {
      const hit = entries.get(key);
      if (hit && Date.now() < hit.expires) return abortable(hit.value, signal);

      const value = load();
      entries.delete(key);
      entries.set(key, { expires: Infinity, value }); // shared while in flight
      value.then(
        (v) => {
          const entry = entries.get(key);
          if (entry?.value === value) entry.expires = Date.now() + ttlOf(v);
        },
        () => {
          if (entries.get(key)?.value === value) entries.delete(key);
        },
      );
      if (entries.size > maxEntries) entries.delete(entries.keys().next().value!);
      return abortable(value, signal);
    },
    clear() {
      entries.clear();
    },
  };
}

/** Wait for `promise`, but reject as soon as `signal` aborts (the promise itself keeps running). */
export function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (err) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}
