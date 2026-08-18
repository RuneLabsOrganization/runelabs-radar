import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb, type Db } from '@/lib/db';
import { jobRuns } from '@/lib/db/schema';
import { withJobRun } from '@/lib/jobs';
import { useTestDb } from './helpers/db';

describe('withJobRun overlap lock', () => {
  let db: Db;

  beforeEach(() => {
    db = useTestDb();
  });

  it('skips when a fresh running row exists (another process owns the job)', async () => {
    db.insert(jobRuns).values({ job: 'ingest', startedAt: new Date(), status: 'running' }).run();

    const res = await withJobRun('ingest', async () => ({ ran: true }));
    expect(res).toBeNull();
  });

  it('reaps a stale running row and proceeds', async () => {
    db.insert(jobRuns)
      .values({ job: 'curate', startedAt: new Date(Date.now() - 60 * 60e3), status: 'running' })
      .run();

    const res = await withJobRun('curate', async () => ({ ran: true }));
    expect(res).toEqual(expect.objectContaining({ ran: true }));

    const stale = db
      .select()
      .from(jobRuns)
      .where(eq(jobRuns.status, 'error'))
      .all()
      .find((r) => r.error?.includes('reaped'));
    expect(stale).toBeDefined();
  });
});
