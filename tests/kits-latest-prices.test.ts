import { describe, it, expect, beforeEach } from 'vitest';
import { useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';
import { kitPicks, metricPoints } from '@/lib/db/schema';
import { runKitPriceBackfill } from '@/lib/kits/grade';
import { PRICING_SOURCE } from '@/lib/ingest/pricing';

function point(entity: string, value: number, date: string) {
  return { source: PRICING_SOURCE, entity, metric: 'price_per_month', value, date, createdAt: new Date() };
}

function seedPick(pickName: string): void {
  db.insert(kitPicks)
    .values({ category: 'coding', task: 'autocomplete', tier: 'best', pickName, updatedAt: new Date() })
    .run();
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
}

let db: Db;
beforeEach(() => {
  db = useTestDb();
});

describe('runKitPriceBackfill price window', () => {
  it('prices from the newest point inside the window, ignoring older history', () => {
    seedPick('Acme Coder');
    db.insert(metricPoints)
      .values([
        point('Acme Coder', 999, daysAgo(400)), // ancient — outside the window
        point('Acme Coder', 20, daysAgo(10)),
        point('Acme Coder', 25, daysAgo(30)),
      ])
      .run();

    expect(runKitPriceBackfill()).toEqual({ updated: 1 });
    const pick = db.select().from(kitPicks).all()[0];
    expect(pick.priceModel).toBe('seat');
    expect(pick.priceUsdMonth).toBe(20);
  });

  it('leaves a pick unpriced when its only points are older than the window', () => {
    seedPick('Dusty Coder');
    db.insert(metricPoints).values(point('Dusty Coder', 12, daysAgo(400))).run();

    expect(runKitPriceBackfill()).toEqual({ updated: 0 });
    expect(db.select().from(kitPicks).all()[0].priceUsdMonth).toBeNull();
  });

  it('is unaffected by points from other sources sharing the window', () => {
    seedPick('Acme Coder');
    db.insert(metricPoints)
      .values([
        point('Acme Coder', 20, daysAgo(5)),
        { source: 'aa', entity: 'Acme Coder', metric: 'price_per_month', value: 1, date: daysAgo(1), createdAt: new Date() },
      ])
      .run();

    expect(runKitPriceBackfill()).toEqual({ updated: 1 });
    expect(db.select().from(kitPicks).all()[0].priceUsdMonth).toBe(20);
  });
});

describe('runKitPriceBackfill per-(entity, metric) pricing', () => {
  it('keeps both metrics of an entity and lets the seat price win — no seat/usage flip', () => {
    // JUSTIFICATION (G3): latestPrices used to keep one row per ENTITY, so an
    // entity with a monthly plan AND a per-unit price kept only the newest —
    // the pick flipped between seat and usage depending on which feeder ran
    // last. Both metrics are now kept, and price_per_month wins by documented
    // precedence.
    seedPick('Acme Coder');
    db.insert(metricPoints)
      .values([
        { source: PRICING_SOURCE, entity: 'Acme Coder', metric: 'price_per_second', value: 0.4, date: daysAgo(1), createdAt: new Date() },
        point('Acme Coder', 20, daysAgo(30)),
      ])
      .run();

    expect(runKitPriceBackfill()).toEqual({ updated: 1 });
    const pick = db.select().from(kitPicks).all()[0];
    expect(pick.priceModel).toBe('seat');
    expect(pick.priceUsdMonth).toBe(20);
    expect(pick.riskFlag).toBeNull();

    // stable across runs — a second run changes nothing
    expect(runKitPriceBackfill()).toEqual({ updated: 0 });
  });

  it('uses the newest usage metric for the risk flag when no seat price exists', () => {
    seedPick('Acme Coder');
    db.insert(metricPoints)
      .values([
        { source: PRICING_SOURCE, entity: 'Acme Coder', metric: 'price_per_second', value: 0.4, date: daysAgo(1), createdAt: new Date() },
        { source: PRICING_SOURCE, entity: 'Acme Coder', metric: 'price_per_image', value: 0.05, date: daysAgo(30), createdAt: new Date() },
      ])
      .run();

    expect(runKitPriceBackfill()).toEqual({ updated: 1 });
    const pick = db.select().from(kitPicks).all()[0];
    expect(pick.priceModel).toBe('usage');
    expect(pick.priceUsdMonth).toBeNull();
    expect(pick.riskFlag).toContain('per second'); // newest usage metric's wording
  });
});
