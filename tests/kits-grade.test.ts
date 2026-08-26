import { describe, it, expect, beforeEach } from 'vitest';
import { useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';
import { kitEvidence, kitPicks } from '@/lib/db/schema';
import { recordMetrics } from '@/lib/metrics';
import { MEDIA_PRICING_SOURCE } from '@/lib/ingest/media-pricing';
import { runKitGrade, runKitPriceBackfill } from '@/lib/kits/grade';

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

describe('kit grade', () => {
  let db: Db;
  const now = new Date('2026-08-26T12:00:00Z');
  const observedAt = new Date('2026-08-20T00:00:00Z');

  beforeEach(() => {
    db = useTestDb();
  });

  function seedPickWithEvidence(urls: string[]) {
    const pickId = db
      .insert(kitPicks)
      .values({
        category: 'video',
        task: 'text-to-video',
        tier: 'value',
        pickName: 'Kling 3.0',
        updatedAt: new Date('2026-07-01T00:00:00Z'),
      })
      .returning({ id: kitPicks.id })
      .get()!.id;
    db.insert(kitEvidence)
      .values(
        urls.map((sourceUrl) => ({
          pickId,
          kind: 'report' as const,
          sourceUrl,
          excerpt: 'holds motion',
          sentiment: 1,
          observedAt,
        })),
      )
      .run();
    return pickId;
  }

  it('grades a pick that has evidence', () => {
    seedPickWithEvidence([
      'https://a.example/1',
      'https://a.example/2',
      'https://b.example/1',
      'https://b.example/2',
      'https://c.example/1',
    ]);

    const result = runKitGrade(now);
    expect(result.graded).toBe(1);

    const row = db.select().from(kitPicks).all()[0];
    expect(row.evidenceCount).toBe(5);
    expect(row.distinctSources).toBe(3);
    expect(row.verifiedAt?.getTime()).toBe(observedAt.getTime());
    expect(row.confidence).toBe('med');
  });

  it('is a no-op on a second run', () => {
    seedPickWithEvidence(['https://a.example/1']);
    expect(runKitGrade(now).graded).toBe(1);
    const updatedAt = db.select().from(kitPicks).all()[0].updatedAt;

    expect(runKitGrade(new Date('2026-08-26T13:00:00Z')).graded).toBe(0);
    expect(db.select().from(kitPicks).all()[0].updatedAt.getTime()).toBe(updatedAt.getTime());
  });

  it('does not abort the run when an evidence URL is malformed', () => {
    seedPickWithEvidence(['https://a.example/ok', 'not a url']);

    expect(() => runKitGrade(now)).not.toThrow();
    const row = db.select().from(kitPicks).all()[0];
    expect(row.evidenceCount).toBe(2);
    expect(row.distinctSources).toBe(2);
  });
});
