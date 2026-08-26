import { expireLeads } from './opportunities/leads';
import { gcCounters } from './usage/counters';

/**
 * Drop expired anonymous leads and stale usage-counter rows. Shared by the
 * daily cron registration in worker/index.ts and manual invocation
 * (`npm run job -- sweep`) via worker/run.ts.
 */
export async function runSweep(): Promise<{ leads: number; counters: number }> {
  return { leads: expireLeads(), counters: gcCounters() };
}
