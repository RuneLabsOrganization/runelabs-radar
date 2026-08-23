/**
 * In-process TTL memo for read aggregates.
 *
 * The web server is a long-lived Node process, and every aggregate behind this
 * helper is rewritten by the worker on a schedule — nightly science, hourly
 * ingest — so serving a value a few seconds old costs nothing in accuracy and
 * removes most of the per-navigation query cost. User-visible writes (votes,
 * batches, plans) deliberately do not go through here.
 *
 * Only active inside the Next.js server. The worker computes and re-reads its
 * own output within a single job, so it must always see the database.
 */

const ENABLED = Boolean(process.env.NEXT_RUNTIME) && process.env.RADAR_DISABLE_MEMO !== '1';
const MAX_ENTRIES = 400;

interface Entry {
  value: unknown;
  expires: number;
}

const store = new Map<string, Entry>();

/** Drop expired entries, then the oldest ones if we are still over budget. */
function sweep(now: number): void {
  for (const [key, entry] of store) {
    if (entry.expires <= now) store.delete(key);
  }
  let excess = store.size - MAX_ENTRIES;
  if (excess <= 0) return;
  for (const key of store.keys()) {
    if (excess-- <= 0) break;
    store.delete(key);
  }
}

export const TTL = {
  /** feed-adjacent counts — ingest lands hourly */
  short: 45_000,
  /** analytics rollups and market snapshots — refreshed daily */
  long: 300_000,
} as const;

export function memo<A extends unknown[], R>(
  name: string,
  ttlMs: number,
  fn: (...args: A) => R,
): (...args: A) => R {
  if (!ENABLED) return fn;
  return (...args: A): R => {
    const key = args.length === 0 ? name : `${name}|${JSON.stringify(args)}`;
    const now = Date.now();
    const hit = store.get(key);
    if (hit && hit.expires > now) return hit.value as R;
    const value = fn(...args);
    store.set(key, { value, expires: now + ttlMs });
    if (store.size > MAX_ENTRIES) sweep(now);
    return value;
  };
}

export function clearMemo(): void {
  store.clear();
}
