import { cache } from 'react';
import { lastOkAt } from './jobs';

export interface ChromeStatus {
  lastSweep: Date | null;
  ingestStale: boolean;
  curateStale: boolean;
}

/**
 * The header's scan indicator. The layout previously resolved the last ingest
 * run twice and curate once on every navigation; this collapses that to one
 * lookup per job, memoized for the request.
 *
 * Never-ran jobs are not "stale" — on a fresh install there is nothing to be
 * late for. Staleness only starts after the first success.
 */
export const chromeStatus = cache((): ChromeStatus => {
  const lastSweep = lastOkAt('ingest');
  const lastCurate = lastOkAt('curate');
  const hoursSince = (at: Date | null) => (at ? (Date.now() - at.getTime()) / 36e5 : null);
  const ingest = hoursSince(lastSweep);
  const curate = hoursSince(lastCurate);
  return {
    lastSweep,
    ingestStale: ingest !== null && ingest > 2,
    curateStale: curate !== null && curate > 3,
  };
});
