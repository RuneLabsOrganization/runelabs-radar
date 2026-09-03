import { beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { jobRuns } from '@/lib/db/schema';
import { insertRunRow, RUNNING_FRESH_MS, withJobRun } from '@/lib/jobs';
import { useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';

describe('insertRunRow — the cross-process run lock', () => {
  let db: Db;
  beforeEach(() => {
    db = useTestDb();
  });

  it('claims the lock by inserting the running row', () => {
    const row = insertRunRow(db, 'ingest');
    expect(row).not.toBeNull();
    expect(row!.job).toBe('ingest');
    expect(row!.status).toBe('running');
  });

  it('treats the partial unique index violation as already-running, not a crash', () => {
    expect(insertRunRow(db, 'ingest')).not.toBeNull();
    // a second live runner for the same job loses the insert race: the
    // job_runs_running_unique partial index rejects it, surfaced as null
    expect(insertRunRow(db, 'ingest')).toBeNull();
    // the lock is per job — a different job claims its own row
    expect(insertRunRow(db, 'curate')).not.toBeNull();
    // only one running row for ingest exists
    const running = db
      .select()
      .from(jobRuns)
      .where(and(eq(jobRuns.job, 'ingest'), eq(jobRuns.status, 'running')))
      .all();
    expect(running).toHaveLength(1);
  });

  it('frees the lock once the run finishes, so the next start succeeds', () => {
    const first = insertRunRow(db, 'ingest')!;
    db.update(jobRuns)
      .set({ status: 'ok', finishedAt: new Date() })
      .where(eq(jobRuns.id, first.id))
      .run();
    const second = insertRunRow(db, 'ingest');
    expect(second).not.toBeNull();
    expect(second!.id).not.toBe(first.id);
  });
});

describe('withJobRun lock behavior', () => {
  let db: Db;
  beforeEach(() => {
    db = useTestDb();
  });

  it('rejects a start while a fresh running row exists (already running)', async () => {
    db.insert(jobRuns).values({ job: 'ingest', startedAt: new Date(), status: 'running' }).run();

    const fn = vi.fn(async () => ({ ran: true }));
    const res = await withJobRun('ingest', fn);
    expect(res).toBeNull();
    expect(fn).not.toHaveBeenCalled();
  });

  it('reaps a stale (>30min) running row and lets the new run start', async () => {
    db.insert(jobRuns)
      .values({ job: 'ingest', startedAt: new Date(Date.now() - RUNNING_FRESH_MS - 60e3), status: 'running' })
      .run();

    const res = await withJobRun('ingest', async () => ({ ran: true }));
    expect(res).toEqual(expect.objectContaining({ ran: true }));

    const stale = db
      .select()
      .from(jobRuns)
      .where(and(eq(jobRuns.job, 'ingest'), eq(jobRuns.status, 'error')))
      .all()
      .find((r) => r.error?.includes('reaped'));
    expect(stale).toBeDefined();
    expect(stale!.finishedAt).not.toBeNull();
    const ok = db
      .select()
      .from(jobRuns)
      .where(and(eq(jobRuns.job, 'ingest'), eq(jobRuns.status, 'ok')))
      .all();
    expect(ok).toHaveLength(1);
  });

  it('starts again after a clean finish — two sequential runs both work', async () => {
    const first = await withJobRun('snapshot', async () => ({ n: 1 }));
    const second = await withJobRun('snapshot', async () => ({ n: 2 }));
    expect(first).toEqual({ n: 1 });
    expect(second).toEqual({ n: 2 });

    const rows = db.select().from(jobRuns).where(eq(jobRuns.job, 'snapshot')).all();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.status)).toEqual(['ok', 'ok']);
  });
});
