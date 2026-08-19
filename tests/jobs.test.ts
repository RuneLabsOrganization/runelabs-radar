import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb, type Db } from '@/lib/db';
import { jobRuns } from '@/lib/db/schema';

vi.mock('@/lib/llm/minimax', () => ({
  drainLlmUsageStats: vi.fn(() => ({ calls: 0, promptTokens: 0, completionTokens: 0 })),
}));

// eslint-disable-next-line import/first
import { withJobRun } from '@/lib/jobs';
// eslint-disable-next-line import/first
import { drainLlmUsageStats } from '@/lib/llm/minimax';
// eslint-disable-next-line import/first
import { useTestDb } from './helpers/db';

describe('withJobRun overlap lock', () => {
  let db: Db;

  beforeEach(() => {
    db = useTestDb();
    vi.mocked(drainLlmUsageStats).mockClear();
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

  it('drains and discards LLM usage when the job throws', async () => {
    const res = await withJobRun('ingest', async () => {
      throw new Error('boom');
    });
    expect(res).toBeNull();
    expect(drainLlmUsageStats).toHaveBeenCalledTimes(1);

    const row = db.select().from(jobRuns).where(eq(jobRuns.status, 'error')).get();
    expect(row?.error).toContain('boom');
  });

  it('does not drain on success — the job drains its own usage into stats', async () => {
    const res = await withJobRun('ingest', async () => ({ ran: true }));
    expect(res).toEqual(expect.objectContaining({ ran: true }));
    expect(drainLlmUsageStats).not.toHaveBeenCalled();
  });
});
