import { describe, it, expect, beforeEach } from 'vitest';
import { useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';
import { kitPicks } from '@/lib/db/schema';

describe('kit_picks table', () => {
  let db: Db;
  beforeEach(() => {
    db = useTestDb();
  });

  it('stores one row per (category, task, tier)', () => {
    db.insert(kitPicks)
      .values({
        category: 'video',
        task: 'text-to-video',
        tier: 'cheapest',
        pickName: 'Example',
        priceModel: 'seat',
        priceUsdMonth: 20,
        confidence: 'high',
        evidenceCount: 34,
        distinctSources: 4,
        verifiedAt: new Date('2026-08-23T00:00:00Z'),
        updatedAt: new Date('2026-08-23T00:00:00Z'),
      })
      .run();
    const rows = db.select().from(kitPicks).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].pickName).toBe('Example');
    expect(rows[0].priceModel).toBe('seat');
  });

  it('rejects a duplicate cell+tier', () => {
    const row = {
      category: 'video',
      task: 'text-to-video',
      tier: 'cheapest' as const,
      pickName: 'A',
      updatedAt: new Date(),
    };
    db.insert(kitPicks).values(row).run();
    expect(() => db.insert(kitPicks).values({ ...row, pickName: 'B' }).run()).toThrow();
  });
});
