import { describe, it, expect, beforeEach } from 'vitest';
import { useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';
import { kitPicks } from '@/lib/db/schema';
import { recordMetrics } from '@/lib/metrics';
import { MEDIA_PRICING_SOURCE } from '@/lib/ingest/media-pricing';
import { runKitPriceBackfill } from '@/lib/kits/grade';

describe('kit price backfill', () => {
  let db: Db;
  beforeEach(() => {
    db = useTestDb();
    db.insert(kitPicks)
      .values([
        { category: 'image', task: 'illustration', tier: 'value', pickName: 'Midjourney Standard', updatedAt: new Date() },
        { category: 'video', task: 'text-to-video', tier: 'value', pickName: 'Kling 3.0', updatedAt: new Date() },
        { category: 'coding', task: 'autocomplete', tier: 'best', pickName: 'Unpriced Thing', updatedAt: new Date() },
      ])
      .run();
    recordMetrics([
      { source: MEDIA_PRICING_SOURCE, entity: 'Midjourney Standard', metric: 'price_per_month', value: 30 },
      { source: MEDIA_PRICING_SOURCE, entity: 'Kling 3.0', metric: 'price_per_second', value: 0.1 },
    ]);
  });

  it('sets a monthly price as a seat price', () => {
    runKitPriceBackfill();
    const row = db.select().from(kitPicks).all().find((r) => r.pickName === 'Midjourney Standard')!;
    expect(row.priceModel).toBe('seat');
    expect(row.priceUsdMonth).toBe(30);
  });

  // INVARIANT: a per-second price is unbounded — it must never become a monthly total.
  it('marks a per-second price as usage with a risk flag and no monthly amount', () => {
    runKitPriceBackfill();
    const row = db.select().from(kitPicks).all().find((r) => r.pickName === 'Kling 3.0')!;
    expect(row.priceModel).toBe('usage');
    expect(row.priceUsdMonth).toBeNull();
    expect(row.riskFlag).toContain('per second');
  });

  it('leaves a pick with no price series untouched', () => {
    runKitPriceBackfill();
    const row = db.select().from(kitPicks).all().find((r) => r.pickName === 'Unpriced Thing')!;
    expect(row.priceUsdMonth).toBeNull();
    expect(row.priceModel).toBe('seat');
    expect(row.riskFlag).toBeNull();
  });

  it('is idempotent', () => {
    const first = runKitPriceBackfill();
    const second = runKitPriceBackfill();
    expect(second.updated).toBe(0);
    expect(first.updated).toBeGreaterThan(0);
  });
});
