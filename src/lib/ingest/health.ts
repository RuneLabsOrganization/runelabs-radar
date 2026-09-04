/**
 * One named verdict per source, derived from the two streak counters AND the
 * wall clock.
 *
 * `stale` is the one that matters: a feed serving 200s with unchanging content
 * never trips consecutiveFailures, so before this existed a dead source looked
 * identical to a quiet one. Errors outrank staleness — a source that is failing
 * to fetch is not "publishing nothing", it is broken.
 *
 * Staleness is judged against the source's OWN cadence (config.pollMinutes /
 * pollHours, via the ingest orchestrator's pollMinutesFor): a source is silent
 * too long after 4 missed expected polls, floored at 10h so fast feeds get the
 * same grace the old fixed 20-empty-poll streak gave a 30-minute cadence. The
 * wall-clock check catches what no counter can: a long-dead source whose
 * counters were reset by a config edit would otherwise report 'ok' forever.
 */
import { pollMinutesFor } from './ingest';
import type { Source } from './types';

export type SourceHealth = 'ok' | 'stale' | 'failing' | 'dead';

export interface SourceHealthVerdict {
  health: SourceHealth;
  reason: string;
}

/** Consecutive zero-new polls before a feed counts as stale (~10h at the default 30min cadence). */
export const STALE_EMPTY_POLLS = 20;
/** Consecutive fetch errors before a source is failing / considered dead. */
export const FAILING_STREAK = 3;
export const DEAD_STREAK = 10;
/** Fast feeds are never time-stale inside this grace, however quick their cadence. */
const MIN_STALE_AFTER_MS = 10 * 36e5;
/** Missed expected polls after which a slower source counts as silent. */
const STALE_MISSED_POLLS = 4;
/** Cadence assumed when the caller can't supply the source config. */
const DEFAULT_POLL_MINUTES = 30;

type HealthInput = Pick<Source, 'consecutiveFailures' | 'consecutiveEmpty' | 'lastFetchedAt'> & {
  /** sources.config JSON — when present, staleness uses the source's own poll cadence. */
  config?: string | null;
};

function parseConfig(config: string | null | undefined): Record<string, unknown> {
  if (!config) return {};
  try {
    const parsed: unknown = JSON.parse(config);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function classifySourceHealth(source: HealthInput, now: number = Date.now()): SourceHealthVerdict {
  if (source.consecutiveFailures >= DEAD_STREAK) {
    return { health: 'dead', reason: `${source.consecutiveFailures} consecutive fetch errors` };
  }
  if (source.consecutiveFailures >= FAILING_STREAK) {
    return { health: 'failing', reason: `${source.consecutiveFailures} consecutive fetch errors` };
  }

  const pollMinutes = source.config ? pollMinutesFor(parseConfig(source.config)) : DEFAULT_POLL_MINUTES;
  const staleAfterMs = Math.max(STALE_MISSED_POLLS * pollMinutes * 60_000, MIN_STALE_AFTER_MS);
  // the empty-poll streak means "no new items for X polls" — its bar must scale
  // with cadence too: 4 empty polls of a 6-hour feed is a day of silence
  const staleEmptyPolls = Math.max(2, Math.ceil(staleAfterMs / (pollMinutes * 60_000)));

  if (source.consecutiveEmpty >= staleEmptyPolls) {
    return {
      health: 'stale',
      reason: `${source.consecutiveEmpty} polls with no new items (cadence ${pollMinutes}min) — fetching fine, publishing nothing`,
    };
  }
  if (!source.lastFetchedAt) return { health: 'ok', reason: 'never fetched' };
  const silentMs = now - source.lastFetchedAt.getTime();
  if (silentMs > staleAfterMs) {
    return {
      health: 'stale',
      reason: `no successful fetch in ${Math.round(silentMs / 36e5)}h (cadence ${pollMinutes}min) — counters may have been reset`,
    };
  }
  return { health: 'ok', reason: 'fetching and yielding' };
}
