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
