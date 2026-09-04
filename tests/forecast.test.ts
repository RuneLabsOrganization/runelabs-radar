import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { getDb } from '@/lib/db';
import { metricPoints } from '@/lib/db/schema';
import { frontierDataAsOf, frontierPriceSeries, projectSeries, type SeriesPoint } from '@/lib/science/forecast';
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

  it('anchors the window at the latest data date, not Date.now() — stale ingestion keeps its tail', () => {
    // ingestion stalled 170 days ago; a now-anchored 150d read window would
    // truncate ALL of this and the forecast would silently fit nothing/old data
    for (let i = 200; i >= 170; i--) seedAa(day(i), 5, 50);

    const series = frontierPriceSeries(120);

    expect(series).toHaveLength(31);
    expect(series[series.length - 1]!.date).toBe(day(170)); // last DATA date, not today
    expect(frontierDataAsOf()).toBe(day(170));
  });

  it('ends at the last data date when ingestion is 10 days stale', () => {
    for (let i = 39; i >= 10; i--) seedAa(day(i), 5, 50);

    const series = frontierPriceSeries(120);

    expect(series[series.length - 1]!.date).toBe(day(10));
    expect(frontierDataAsOf()).toBe(day(10));
  });
});

describe('projectSeries fit accounting', () => {
  beforeEach(() => useTestDb());

  // ascending dates ending today
  const hist = (vals: number[]): SeriesPoint[] =>
    vals.map((v, i) => ({ date: day(vals.length - 1 - i), value: v }));

  it('excludes non-positive days from the fit and reports the dropped count', () => {
    // a zero-price day cannot enter a log-space fit — it must be dropped AND
    // reported, not silently excluded while counting toward the history length
    const f = projectSeries(hist([10, 9, 0, 8, 7, 6]), 30);
    expect(f.droppedFromFit).toBe(1);
    expect(f.daysOfHistory).toBe(5); // only fitted days count
    expect(f.projection.length).toBeGreaterThan(0);
    expect(f.history).toHaveLength(6); // history itself is returned intact
  });

  it('dropped days do not count toward the 5-day fit minimum', () => {
    const f = projectSeries(hist([10, 0, 9, 8, 7]), 30); // 4 usable days
    expect(f.daysOfHistory).toBe(4);
    expect(f.droppedFromFit).toBe(1);
    expect(f.projection).toEqual([]);
    expect(f.fit).toBeNull();
  });

  it('keeps projecting a flat series regardless of the r2-on-constant convention', () => {
    // math.ts linearFit reports r2 = 1 on a constant series today; another
    // stream is changing that to 0 — projectSeries must work under either
    const f = projectSeries(hist([5, 5, 5, 5, 5, 5]), 30);
    expect(f.fit).not.toBeNull();
    expect(f.projection.length).toBeGreaterThan(0);
    expect(f.projection[0]!.mid).toBeCloseTo(5, 5);
  });
});

describe('ForecastChart disclosure labels', () => {
  // no component-render infra in this suite (node environment) — the
  // disclosure wording is guarded at source level so it can't silently regress
  const src = readFileSync(new URL('../src/components/ForecastChart.tsx', import.meta.url), 'utf8');

  it('labels r² as computed in log-price space (it sits next to a $ chart)', () => {
    expect(src).toContain('r&sup2; (log price)');
  });

  it('states the band is a heuristic, not a confidence interval', () => {
    expect(src).toContain('not a confidence interval');
  });
});
