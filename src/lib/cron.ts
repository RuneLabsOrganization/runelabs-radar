import cron from 'node-cron';

/**
 * node-cron 3 checks each task once a second and, by default, fires ONLY when
 * that check lands inside the scheduled second. A synchronous job (better-sqlite3
 * is synchronous — the hourly rescore, curate's clustering) that holds the event
 * loop across 08:00:00 makes every other task due at that second check late and
 * silently skip — no job_runs row, no log. That is how the Sunday 08:00
 * weekly-report, sharing its second with the then-08:00 daily rescore, ran once
 * in three months. With recoverMissedExecutions the late check fires the missed
 * tick instead (once — node-cron tracks the last execution).
 */
export const CRON_OPTIONS = { recoverMissedExecutions: true } as const;

export function schedule(expression: string, task: () => void): cron.ScheduledTask {
  return cron.schedule(expression, task, CRON_OPTIONS);
}
