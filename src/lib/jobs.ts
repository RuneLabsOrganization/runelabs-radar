import { and, desc, eq } from 'drizzle-orm';
import { getDb } from './db';
import { jobRuns } from './db/schema';

export type JobName =
  | 'ingest'
  | 'curate'
  | 'board'
  | 'brief'
  | 'stacks'
  | 'snapshot'
  | 'velocity'
  | 'launches'
  | 'embed'
  | 'pain'
  | 'science'
  | 'opportunities';

// In-process overlap guard: a slow run (e.g. curate during a MiniMax incident)
// must not overlap the next cron tick — overlapping curates would double-score
// the same raw stories and double-burn the daily LLM cap.
const running = new Set<JobName>();

/** Runs fn inside a recorded job run. Returns fn's stats, or null when it threw or the job was already running. */
export async function withJobRun<T extends Record<string, unknown>>(
  job: JobName,
  fn: () => Promise<T>,
): Promise<T | null> {
  if (running.has(job)) {
    console.warn(`[job:${job}] skipped — previous run still in progress`);
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
