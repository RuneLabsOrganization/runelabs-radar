import { describe, expect, it } from 'vitest';
import { cellAlpha, globalMax, isWeekend, rowMaxes } from '@/lib/heat';
import type { DayCount } from '@/lib/analytics';

function day(date: string, total: number, byDomain: Partial<Record<string, number>> = {}): DayCount {
  return {
    date,
    total,
    byDomain: {
      coding: 0, copy: 0, image: 0, video: 0, ads: 0, agentic: 0,
      ...byDomain,
    } as DayCount['byDomain'],
  };
}

describe('rowMaxes / globalMax', () => {
  const days = [
    day('2026-08-01', 3, { coding: 3 }),
    day('2026-08-02', 12, { coding: 10, video: 4 }),
    day('2026-08-03', 0), // zero day
  ];

  it('computes per-sector maxima including zero days', () => {
    const m = rowMaxes(days);
    expect(m.coding).toBe(10);
    expect(m.video).toBe(4);
    expect(m.ads).toBe(0);
  });

  it('computes the single largest cell', () => {
    expect(globalMax(days)).toBe(10);
    expect(globalMax([])).toBe(0);
  });
});

describe('cellAlpha', () => {
  it('returns 0 for empty cells or degenerate max', () => {
    expect(cellAlpha(0, 10)).toBe(0);
    expect(cellAlpha(5, 0)).toBe(0);
    expect(cellAlpha(0, 0)).toBe(0);
  });

  it('ramps from the 0.14 floor to 1 at max', () => {
    expect(cellAlpha(1, 10)).toBeCloseTo(0.14 + 0.86 * 0.1);
    expect(cellAlpha(10, 10)).toBeCloseTo(1);
    expect(cellAlpha(20, 10)).toBeCloseTo(1); // clamps
    expect(cellAlpha(5, 10)).toBeGreaterThan(cellAlpha(2, 10));
  });
});

describe('isWeekend', () => {
  it('flags Saturday and Sunday (UTC)', () => {
    expect(isWeekend('2026-08-08')).toBe(true); // Sat
    expect(isWeekend('2026-08-09')).toBe(true); // Sun
    expect(isWeekend('2026-08-10')).toBe(false); // Mon
  });
});
