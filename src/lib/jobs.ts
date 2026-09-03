import { and, desc, eq, gte, lt } from 'drizzle-orm';
import { getDb, type Db } from './db';
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
  | 'kit-prices'
  | 'kit-grade'
  | 'source-review'
  | 'verdict-grade';

// In-process overlap guard: a slow run (e.g. curate during a MiniMax incident)
// must not overlap the next cron tick — overlapping curates would double-score
// the same raw stories and double-burn the daily LLM cap.
const running = new Set<JobName>();

/** A 'running' row younger than this means another live process owns the job. Also the read-side threshold (jobHistory) past which a running row is shown as failed. */
export const RUNNING_FRESH_MS = 30 * 60 * 1000;

/** better-sqlite3 surfaces constraint failures as a SqliteError with a string code; drizzle passes it through untouched. */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && 'code' in e && e.code === 'SQLITE_CONSTRAINT_UNIQUE';
}

/**
 * Cross-process run lock: inserting the 'running' row IS the lock acquisition.
 * The partial unique index job_runs_running_unique (ON job_runs(job) WHERE
 * status='running') makes this race-safe — a daemon cron tick and an
 * `npm run job` CLI that both pass the pre-check in the same millisecond
 * cannot both insert; the loser gets a unique violation instead of a double
 * run (double LLM spend). Returns the new row, or null when the lock is held.
 */
export function insertRunRow(db: Db, job: JobName): typeof jobRuns.$inferSelect | null {
  try {
    return db.insert(jobRuns).values({ job, startedAt: new Date(), status: 'running' }).returning().get();
  } catch (e) {
    if (isUniqueViolation(e)) return null;
    throw e;
  }
}

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
  // fast path: a fresh running row means another process owns the job right
  // now. Best-effort only — the authoritative check is the unique index on
  // the insert below, which closes the check-then-insert race.
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
  const row = insertRunRow(db, job);
  if (!row) {
    console.warn(`[job:${job}] skipped — another process holds the run lock`);
    return null;
  }
  running.add(job);
  try {
    return await runRecorded(job, row.id, fn);
  } finally {
    running.delete(job);
  }
}

async function runRecorded<T extends Record<string, unknown>>(
  job: JobName,
  runId: number,
  fn: () => Promise<T>,
): Promise<T | null> {
  const db = getDb();
  try {
    const stats = await fn();
    db.update(jobRuns)
      .set({ status: 'ok', finishedAt: new Date(), stats: JSON.stringify(stats) })
      .where(eq(jobRuns.id, runId))
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
      .where(eq(jobRuns.id, runId))
      .run();
    console.error(`[job:${job}] failed:`, e);
    return null;
  }
}

/**
 * Fire-and-forget runner for cron callbacks and the worker boot chain.
 * withJobRun can reject before its internal try/catch — first-call getDb()
 * running migrations, lock queries hitting SQLITE_BUSY past busy_timeout —
 * and an unhandled rejection kills the Node process; docker restart then
 * re-runs the boot-chain ingest/curate/embed on every crash loop. Log the
 * rejection, never let it escape.
 */
export function fireAndForget(promise: Promise<unknown>, label: string): void {
  void promise.catch((e: unknown) => {
    console.error(`[worker] fire-and-forget "${label}" rejected:`, e);
  });
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
