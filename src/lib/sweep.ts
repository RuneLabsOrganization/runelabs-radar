import { notLike } from 'drizzle-orm';
import { getDb } from './db';
import { launches } from './db/schema';
import { expireLeads } from './opportunities/leads';
import { gcCounters } from './usage/counters';

/**
 * Drop expired anonymous leads and stale usage-counter rows. Shared by the
 * daily cron registration in worker/index.ts and manual invocation
 * (`npm run job -- sweep`) via worker/run.ts.
 */
export async function runSweep(): Promise<{ leads: number; counters: number; launches: number }> {
  return { leads: expireLeads(), counters: gcCounters(), launches: sweepUnsafeLaunchUrls() };
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
