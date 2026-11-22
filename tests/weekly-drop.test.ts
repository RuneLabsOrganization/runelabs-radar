import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { batches, opportunities } from '@/lib/db/schema';
import { createWeeklyRadarDrop, getBatchItems, listBatchesForUser } from '@/lib/batches';
import { useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';

function seedOpp(
  db: Db,
  slug: string,
  verdict: 'pursue' | 'watch' | 'reject',
  flip: number,
  opts: { confidence?: number; owner?: number | null; status?: 'active' | 'archived' } = {},
) {
  const now = new Date();
  return db
    .insert(opportunities)
    .values({
      slug,
      ownerUserId: opts.owner ?? null,
      title: slug,
      thesis: 'A sufficiently long thesis to satisfy any downstream validation rules.',
      sector: 'devtools',
      status: opts.status ?? 'active',
      flipScore: flip,
      holdScore: 50,
      scores: '{}',
      evidence: '[]',
      verdict,
      confidence: opts.confidence ?? 70,
      firstSeenAt: now,
      lastSeenAt: now,
    })
    .returning()
    .get()!;
}

describe('weekly radar drop', () => {
  let db: Db;
  beforeEach(() => {
    db = useTestDb();
  });

  it('with no pursue-grade openings, fills from the best reviewed watch openings by flip score', async () => {
    seedOpp(db, 'watch-low', 'watch', 55);
    seedOpp(db, 'watch-high', 'watch', 80);
    seedOpp(db, 'rejected', 'reject', 99);
    const { slug, count } = await createWeeklyRadarDrop();
    expect(count).toBe(2);
    const batch = db.select().from(batches).where(eq(batches.slug, slug)).get()!;
    expect(getBatchItems(batch.id).map((i) => i.refKey)).toEqual(['watch-high', 'watch-low']);
    expect(batch.description).toMatch(/0 pursue-grade and the 2 strongest "watch"/);
  });

  it('ranks pursue ahead of watch and tops up to ten', async () => {
    seedOpp(db, 'p1', 'pursue', 60);
    for (let i = 0; i < 12; i++) seedOpp(db, `w${i}`, 'watch', 70 + i);
    const { slug, count } = await createWeeklyRadarDrop();
    expect(count).toBe(10);
    const keys = getBatchItems(db.select().from(batches).where(eq(batches.slug, slug)).get()!.id).map((i) => i.refKey);
    expect(keys[0]).toBe('p1');
    expect(keys[1]).toBe('w11'); // best watch next
  });

  it('skips unreviewed / low-confidence watch rows, archived rows and private rows', async () => {
    seedOpp(db, 'unverified', 'watch', 90, { confidence: 40 });
    seedOpp(db, 'archived', 'watch', 90, { status: 'archived' });
    seedOpp(db, 'private', 'watch', 90, { owner: 1 });
    seedOpp(db, 'good', 'watch', 50, { confidence: 50 });
    const { slug } = await createWeeklyRadarDrop();
    const keys = getBatchItems(db.select().from(batches).where(eq(batches.slug, slug)).get()!.id).map((i) => i.refKey);
    expect(keys).toEqual(['good']);
  });

  it('does not create an empty drop when nothing qualifies', async () => {
    seedOpp(db, 'rejected', 'reject', 90);
    const { count } = await createWeeklyRadarDrop();
    expect(count).toBe(0);
    expect(db.select().from(batches).all()).toHaveLength(0);
  });

  it('refills an empty drop for the week instead of leaving it empty, and keeps a filled drop as is', async () => {
    const first = await createWeeklyRadarDrop(); // nothing yet → no row
    expect(first.count).toBe(0);
    // an empty drop left behind by the old behaviour
    db.insert(batches)
      .values({
        ownerId: null, kind: 'drop', slug: first.slug, title: 'Radar Batch', cohort: 'x', visibility: 'members',
        createdAt: new Date(), updatedAt: new Date(),
      })
      .run();
    seedOpp(db, 'late', 'watch', 60);
    const refilled = await createWeeklyRadarDrop();
    expect(refilled.count).toBe(1);
    expect(db.select().from(batches).all()).toHaveLength(1);
    seedOpp(db, 'later', 'watch', 99);
    expect((await createWeeklyRadarDrop()).count).toBe(1); // filled drop is final for the week
  });

  it('listBatchesForUser hides drops that hold nothing', async () => {
    db.insert(batches)
      .values({
        ownerId: null, kind: 'drop', slug: 'radar-empty', title: 'Empty', cohort: 'e', visibility: 'members',
        createdAt: new Date(), updatedAt: new Date(),
      })
      .run();
    seedOpp(db, 'w', 'watch', 60);
    await createWeeklyRadarDrop();
    const titles = listBatchesForUser(null).map((b) => b.title);
    expect(titles).not.toContain('Empty');
    expect(titles).toHaveLength(1);
  });
});
