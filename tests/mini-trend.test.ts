import { describe, it, expect } from 'vitest';
import { trendBars } from '@/components/MiniTrend';

describe('trendBars — MiniTrend bar presentation', () => {
  it('accents the last bar when the series is fully complete', () => {
    const bars = trendBars([1, 2, 3]);
    expect(bars.map((b) => b.accent)).toEqual([false, false, true]);
    expect(bars.every((b) => !b.partial)).toBe(true);
  });

  it('never accents the partial-today bar — the accent falls back to the latest complete day', () => {
    // the regression: a half-counted today read as the accented "decline"
    const bars = trendBars([5, 8, 1], true);
    expect(bars[2].partial).toBe(true);
    expect(bars[2].accent).toBe(false);
    expect(bars[1].accent).toBe(true);
    expect(bars[0]).toMatchObject({ accent: false, partial: false });
  });

  it('marks nothing when partialLast is set on a series without a partial bucket', () => {
    // caller passes partialLast only when the last bucket IS today, but a
    // single-bar series must not crash or accent bar -1
    const bars = trendBars([4], true);
    expect(bars).toEqual([{ v: 4, accent: false, partial: true }]);
  });
});
