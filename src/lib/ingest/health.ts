/**
 * One named verdict per source, derived from the two streak counters.
 *
 * `stale` is the one that matters: a feed serving 200s with unchanging content
 * never trips consecutiveFailures, so before this existed a dead source looked
 * identical to a quiet one. Errors outrank staleness — a source that is failing
 * to fetch is not "publishing nothing", it is broken.
 */
import type { Source } from './types';

export type SourceHealth = 'ok' | 'stale' | 'failing' | 'dead';

export interface SourceHealthVerdict {
  health: SourceHealth;
  reason: string;
}

/** Consecutive zero-new polls before a feed counts as stale (~10h at 30min cadence). */
export const STALE_EMPTY_POLLS = 20;
/** Consecutive fetch errors before a source is failing / considered dead. */
export const FAILING_STREAK = 3;
export const DEAD_STREAK = 10;

type HealthInput = Pick<Source, 'consecutiveFailures' | 'consecutiveEmpty' | 'lastFetchedAt'>;

export function classifySourceHealth(source: HealthInput): SourceHealthVerdict {
  if (source.consecutiveFailures >= DEAD_STREAK) {
    return { health: 'dead', reason: `${source.consecutiveFailures} consecutive fetch errors` };
  }
  if (source.consecutiveFailures >= FAILING_STREAK) {
    return { health: 'failing', reason: `${source.consecutiveFailures} consecutive fetch errors` };
  }
  if (source.consecutiveEmpty >= STALE_EMPTY_POLLS) {
    return {
      health: 'stale',
      reason: `${source.consecutiveEmpty} polls with no new items — fetching fine, publishing nothing`,
    };
  }
  if (!source.lastFetchedAt) return { health: 'ok', reason: 'never fetched' };
  return { health: 'ok', reason: 'fetching and yielding' };
}
