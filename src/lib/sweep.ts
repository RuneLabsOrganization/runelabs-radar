import { notLike } from 'drizzle-orm';
import { reapStaleBatchRuns } from './batches';
import { pruneBenchmarkSnapshots } from './board/sync';
import { getDb } from './db';
import { launches } from './db/schema';
import { sweepExpiredOAuth } from './oauth';
import { expireLeads } from './opportunities/leads';
import { gcCounters } from './usage/counters';

/**
 * Drop expired anonymous leads, stale usage-counter rows, unsafe legacy launch
 * URLs, ancient benchmark snapshots, batch_runs rows orphaned mid-run, and
 * OAuth codes/tokens past their usable life.
 * Shared by the daily cron registration in worker/index.ts and manual
 * invocation (`npm run job -- sweep`) via worker/run.ts.
 */
export async function runSweep(): Promise<{
  leads: number;
  counters: number;
  launches: number;
  snapshots: number;
  batchRuns: number;
  oauthCodes: number;
  oauthTokens: number;
}> {
  const oauth = sweepExpiredOAuth();
  return {
    leads: expireLeads(),
    counters: gcCounters(),
    launches: sweepUnsafeLaunchUrls(),
    snapshots: pruneBenchmarkSnapshots(),
    batchRuns: reapStaleBatchRuns(),
    oauthCodes: oauth.codes,
    oauthTokens: oauth.tokens,
  };
}

/**
 * Legacy rows inserted before the http(s)-only launch invariant: anything not
 * starting with http:// or https:// (javascript:, data:, …) must never render.
 */
export function sweepUnsafeLaunchUrls(): number {
  const db = getDb();
  const removed = db
    .delete(launches)
    .where(notLike(launches.url, 'http%'))
    .run();
  return removed.changes;
}
