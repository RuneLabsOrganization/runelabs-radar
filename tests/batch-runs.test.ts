import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { batches, batchRuns, planEntitlements } from '@/lib/db/schema';
import { BATCH_RUN_FRESH_MS, reapStaleBatchRuns, runBatchOp } from '@/lib/batches';
import { seedUser, useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';

vi.mock('@/lib/plans/generate', () => ({
  generatePlan: vi.fn(async (oppId: number) => ({ ok: true as const, plan: {}, cached: true })),
}));

function seedBatch(db: Db, ownerId: number): number {
  const now = new Date();
  return db
    .insert(batches)
    .values({ ownerId, kind: 'workspace', slug: `b-${ownerId}`, title: 'B', visibility: 'private', createdAt: now, updatedAt: now })
    .returning({ id: batches.id })
    .get()!.id;
}

function seedRun(db: Db, batchId: number, status: 'running' | 'ok', ageMs: number): number {
  return db
    .insert(batchRuns)
    .values({
      batchId,
      op: 'plan',
      status,
      createdAt: new Date(Date.now() - ageMs),
      finishedAt: status === 'ok' ? new Date(Date.now() - ageMs + 1000) : null,
    })
    .returning({ id: batchRuns.id })
    .get()!.id;
}

describe('reapStaleBatchRuns', () => {
  let db: Db;
  let batchId: number;
  beforeEach(() => {
    db = useTestDb();
    const userId = seedUser(db);
    batchId = seedBatch(db, userId);
  });

  it('marks a running row older than 30min as error', () => {
    const id = seedRun(db, batchId, 'running', BATCH_RUN_FRESH_MS + 60e3);

    expect(reapStaleBatchRuns()).toBe(1);
    const row = db.select().from(batchRuns).where(eq(batchRuns.id, id)).get()!;
    expect(row.status).toBe('error');
    expect(row.error).toContain('reaped');
    expect(row.finishedAt).not.toBeNull();
  });

  it('leaves a fresh running row alone', () => {
    const id = seedRun(db, batchId, 'running', 5 * 60e3);

    expect(reapStaleBatchRuns()).toBe(0);
    const row = db.select().from(batchRuns).where(eq(batchRuns.id, id)).get()!;
    expect(row.status).toBe('running');
    expect(row.finishedAt).toBeNull();
  });

  it('leaves a completed row alone, however old', () => {
    const id = seedRun(db, batchId, 'ok', 2 * 60 * 60e3);

    expect(reapStaleBatchRuns()).toBe(0);
    const row = db.select().from(batchRuns).where(eq(batchRuns.id, id)).get()!;
    expect(row.status).toBe('ok');
    expect(row.error).toBeNull();
  });

  it('runBatchOp reaps the stale row before recording its own run', async () => {
    const userId = seedUser(db);
    db.insert(planEntitlements).values({ userId, tier: 'builder', plansPerMonth: 30, resetDay: 1 }).run();
    const staleId = seedRun(db, batchId, 'running', BATCH_RUN_FRESH_MS + 60e3);

    // an empty batch exercises the reaper + run bookkeeping with no LLM calls
    const run = await runBatchOp(batchId, 'plan', userId);
    expect(run.status).toBe('ok');
    expect(JSON.parse(run.stats!)).toEqual({ total: 0, ok: 0, error: 0 });

    const stale = db.select().from(batchRuns).where(eq(batchRuns.id, staleId)).get()!;
    expect(stale.status).toBe('error');
    expect(stale.error).toContain('reaped');
  });
});
