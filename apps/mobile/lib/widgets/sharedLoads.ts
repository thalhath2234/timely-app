/**
 * Widgets redraw in bursts (the app's refresh, the background refresh, Android
 * redrawing several at once), and each one loads what its card reads. Within a
 * burst they share each request: three cards that read tasks make one call.
 * A request is kept briefly, a failed one isn't kept at all, and everything is
 * dropped when something changes so the next draw reads fresh data.
 */

export const SHARED_MS = 15_000;

export function sharedLoads(clock: () => number = Date.now) {
  const loads = new Map<string, { at: number; promise: Promise<unknown> }>();

  /** `load()` once per key while it's fresh; undefined when it fails. */
  function shared<T>(key: string, load: () => Promise<T>): Promise<T | undefined> {
    const now = clock();
    const hit = loads.get(key);
    if (hit && now - hit.at < SHARED_MS) return hit.promise as Promise<T | undefined>;
    const promise = load().catch(() => undefined);
    loads.set(key, { at: now, promise });
    void promise.then((value) => {
      if (value === undefined && loads.get(key)?.promise === promise) loads.delete(key);
    });
    return promise;
  }

  return { shared, forget: () => loads.clear() };
}
