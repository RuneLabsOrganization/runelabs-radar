import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db';
import { metricPoints } from '@/lib/db/schema';
import { frontierPriceSeries } from '@/lib/science/forecast';
import { useTestDb } from './helpers/db';

const DAY = 864e5;
const day = (agoDays: number) => new Date(Date.now() - agoDays * DAY).toISOString().slice(0, 10);

function seedAa(dateStr: string, price: number, intel: number) {
  getDb()
    .insert(metricPoints)
    .values([
      { source: 'aa', entity: 'frontier-model', metric: 'intelligence', value: intel, date: dateStr, createdAt: new Date() },
      { source: 'aa', entity: 'frontier-model', metric: 'price_blended', value: price, date: dateStr, createdAt: new Date() },
    ])
    .run();
}

describe('frontierPriceSeries bounded window', () => {
  beforeEach(() => useTestDb());

  it('matches slice(-120) of the full-data computation on contiguous history', () => {
    for (let i = 179; i >= 0; i--) seedAa(day(i), 10 - i * 0.01, 50);

    const series = frontierPriceSeries(120);

    const expected = Array.from({ length: 120 }, (_, k) => {
      const ago = 119 - k;
      return { date: day(ago), value: 10 - ago * 0.01 };
    });
    expect(series).toEqual(expected);
  });

  it('excludes points beyond the read window even when the series comes up short', () => {
    for (let i = 9; i >= 0; i--) seedAa(day(i), 5, 50);
    for (let i = 174; i >= 170; i--) seedAa(day(i), 1, 50); // ancient history, outside the 150d window

    const series = frontierPriceSeries(120);

    expect(series).toHaveLength(10); // the unbounded scan would have returned 15
    expect(series.every((p) => p.date >= day(150))).toBe(true);
  });
});
