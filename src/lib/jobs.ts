import { and, desc, eq, gte, lt } from 'drizzle-orm';
import { getDb } from './db';
import { jobRuns } from './db/schema';
import { drainLlmUsageStats } from './llm/minimax';

export type JobName =
  | 'ingest'
  | 'curate'
  | 'gate-audit'
  | 'board'
  | 'brief'
  | 'rescore'
  | 'stacks'
  | 'snapshot'
  | 'velocity'
  | 'launches'
  | 'embed'
  | 'pain'
  | 'science'
  | 'opportunities'
  | 'opp-rescore'
  | 'second-look'
  | 'pricing'
  | 'openbench'
  | 'dataset-dump'
  | 'weekly-report'
  | 'agent-plans'
  | 'agent-stacks'
  | 'radar-eval'
  | 'radar-batch'
  | 'sweep'
  | 'media-pricing'
  | 'kit-evidence'
  | 'kit-grade'
  | 'source-review'
  | 'verdict-grade';

// In-process overlap guard: a slow run (e.g. curate during a MiniMax incident)
// must not overlap the next cron tick — overlapping curates would double-score
// the same raw stories and double-burn the daily LLM cap.
const running = new Set<JobName>();

/** A 'running' row younger than this means another live process owns the job. Also the read-side threshold (jobHistory) past which a running row is shown as failed. */
export const RUNNING_FRESH_MS = 30 * 60 * 1000;

/** Runs fn inside a recorded job run. Returns fn's stats, or null when it threw or the job was already running. */
export async function withJobRun<T extends Record<string, unknown>>(
  job: JobName,
  fn: () => Promise<T>,
): Promise<T | null> {
  if (running.has(job)) {
    console.warn(`[job:${job}] skipped — previous run still in progress`);
    return null;
  }
  const db = getDb();
  // reap stale 'running' rows (a process died mid-run) so they never lock the job
  db.update(jobRuns)
    .set({ status: 'error', finishedAt: new Date(), error: 'stale running row reaped — process died mid-run' })
    .where(
      and(eq(jobRuns.job, job), eq(jobRuns.status, 'running'), lt(jobRuns.startedAt, new Date(Date.now() - RUNNING_FRESH_MS))),
    )
    .run();
  // cross-process lock: the daemon and CLI runs share a DB — a fresh running
  // row means the other process owns the job right now
  const freshRunning = db
    .select({ id: jobRuns.id })
    .from(jobRuns)
    .where(
      and(eq(jobRuns.job, job), eq(jobRuns.status, 'running'), gte(jobRuns.startedAt, new Date(Date.now() - RUNNING_FRESH_MS))),
    )
    .get();
  if (freshRunning) {
    console.warn(`[job:${job}] skipped — another process holds the run lock`);
    return null;
  }
  running.add(job);
  try {
    return await runRecorded(job, fn);
  } finally {
    running.delete(job);
  }
}

async function runRecorded<T extends Record<string, unknown>>(
  job: JobName,
  fn: () => Promise<T>,
): Promise<T | null> {
  const db = getDb();
  const row = db
    .insert(jobRuns)
    .values({ job, startedAt: new Date(), status: 'running' })
    .returning()
    .get();
  try {
    const stats = await fn();
    db.update(jobRuns)
      .set({ status: 'ok', finishedAt: new Date(), stats: JSON.stringify(stats) })
      .where(eq(jobRuns.id, row.id))
      .run();
    return stats;
  } catch (e) {
    // drain-and-discard: a failed run's LLM usage must not linger in the
    // module-level counters and leak into the next successful job's stats
    // (success paths drain into their own stats JSON, e.g. curate.ts)
    drainLlmUsageStats();
    db.update(jobRuns)
      .set({
        status: 'error',
        finishedAt: new Date(),
        error: e instanceof Error ? (e.stack ?? e.message) : String(e),
      })
      .where(eq(jobRuns.id, row.id))
      .run();
    console.error(`[job:${job}] failed:`, e);
    return null;
  }
}

export function lastOkAt(job: JobName): Date | null {
  const db = getDb();
  const row = db
    .select()
    .from(jobRuns)
    .where(and(eq(jobRuns.job, job), eq(jobRuns.status, 'ok')))
    .orderBy(desc(jobRuns.finishedAt))
    .limit(1)
    .get();
  return row?.finishedAt ?? null;
}

export function hoursSinceLastOk(job: JobName): number | null {
  const at = lastOkAt(job);
  return at ? (Date.now() - at.getTime()) / 36e5 : null;
}

/** Never-ran jobs are not "stale" (fresh install); staleness starts after first success. */
export function getStaleness(): { ingestStale: boolean; curateStale: boolean } {
  const ingest = hoursSinceLastOk('ingest');
  const curate = hoursSinceLastOk('curate');
  return {
    ingestStale: ingest !== null && ingest > 2,
    curateStale: curate !== null && curate > 3,
  };
}
