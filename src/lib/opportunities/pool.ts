/**
 * Process-local, NOT persisted. Best-effort: reduces same-day cursor drift
 * within one running process when the primitive pool would otherwise reload
 * (a pain job re-runs, a story gets curated) between get_leads pages.
 *
 * Does not survive a restart and does not help across replicas. A full fix
 * would persist a per-(owner, day) snapshot to the DB instead. Staleness
 * here mixes slightly different page content — not a security or billing
 * issue — so an in-memory cache keyed by dayKey() is the stopping point.
 */
import { loadPrimitives, type Primitive } from './primitives';
import { dayKey } from './seed';
import { loadWedges, type WedgeSpace } from './wedges';

let poolCache: { day: string; primitives: Primitive[]; space: WedgeSpace } | null = null;
let dayOverride: string | null = null;

function cacheDay(): string {
  return dayOverride ?? dayKey();
}

export function getStablePool(): { primitives: Primitive[]; space: WedgeSpace } {
  const day = cacheDay();
  if (poolCache?.day !== day) {
    poolCache = { day, primitives: loadPrimitives(), space: loadWedges() };
  }
  return { primitives: poolCache.primitives, space: poolCache.space };
}

/** Drop the in-memory pool. Tests call this when they swap the DB. */
export function _resetPoolCache(): void {
  poolCache = null;
}

/** Force the cache key as if the calendar day rolled over. Tests only. */
export function _setPoolDayForTests(day: string | null): void {
  dayOverride = day;
}
