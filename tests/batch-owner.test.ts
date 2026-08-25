import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { batches, batchItems, opportunities, planEntitlements } from '@/lib/db/schema';
import { createWeeklyRadarDrop, getBatchItems, runBatchOp } from '@/lib/batches';
import { generatePlan } from '@/lib/plans/generate';
import { seedUser, useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';

vi.mock('@/lib/plans/generate', () => ({
  generatePlan: vi.fn(async (oppId: number) => ({ ok: true as const, plan: {}, cached: true })),
}));

const planMock = vi.mocked(generatePlan);

function seedPursue(db: Db, slug: string, ownerUserId: number | null, flip: number, title: string) {
  const now = new Date();
  return db
    .insert(opportunities)
    .values({
      slug,
      ownerUserId,
      title,
      thesis: 'A sufficiently long thesis to satisfy any downstream validation rules.',
      sector: 'devtools',
      status: 'active',
      flipScore: flip,
      holdScore: 50,
      scores: '{}',
      evidence: '[]',
      verdict: 'pursue',
      confidence: 70,
      firstSeenAt: now,
      lastSeenAt: now,
    })
    .returning()
    .get()!;
}

describe('weekly radar drop is public-only', () => {
  let db: Db;
  beforeEach(() => {
    db = useTestDb();
  });

  it('omits private pursue openings from the members drop', async () => {
    seedPursue(db, 'public-pursue', null, 70, 'Public pursue');
    seedPursue(db, 'alice-secret', 1, 99, 'SECRET PRIVATE OPENING THAT MUST NOT LEAK');

    const { slug, count } = await createWeeklyRadarDrop();
    expect(count).toBe(1);
    const batch = db.select().from(batches).where(eq(batches.slug, slug)).get()!;
    const keys = getBatchItems(batch.id).map((i) => i.refKey);
    expect(keys).toEqual(['public-pursue']);
    expect(keys).not.toContain('alice-secret');
  });
});

describe('batch plan slug lookup prefers the caller private row', () => {
  let db: Db;
  beforeEach(() => {
    db = useTestDb();
    planMock.mockClear();
    seedUser(db, 1);
    db.insert(planEntitlements)
      .values({ userId: 1, tier: 'builder', plansPerMonth: 30, resetDay: 1 })
      .run();
  });

  it('resolves a shared slug to the owned row rather than the public one', async () => {
    const pub = seedPursue(db, 'canonical', null, 70, 'Public canonical');
    const owned = seedPursue(db, 'canonical', 1, 70, 'Alice private canonical');
    const now = new Date();
    const batch = db
      .insert(batches)
      .values({
        ownerId: 1,
        kind: 'workspace',
        slug: 'alice-batch',
        title: 'Alice batch',
        visibility: 'private',
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get()!;
    db.insert(batchItems)
      .values({
        batchId: batch.id,
        refType: 'opportunity',
        refKey: 'canonical',
        refId: null,
        position: 0,
        createdAt: now,
      })
      .run();

    const run = await runBatchOp(batch.id, 'plan', 1);
    expect(run.status).toBe('ok');
    expect(planMock).toHaveBeenCalledTimes(1);
    expect(planMock.mock.calls[0]![0]).toBe(owned.id);
    expect(planMock.mock.calls[0]![0]).not.toBe(pub.id);
  });
});
