import { describe, expect, it } from 'vitest';
import { seedFor, permuteIndex, sliceFor } from '@/lib/opportunities/seed';

describe('seedFor', () => {
  it('is deterministic for the same inputs', () => {
    expect(seedFor('user:1', '2026-08-25')).toBe(seedFor('user:1', '2026-08-25'));
  });

  it('differs across callers and across days', () => {
    expect(seedFor('user:1', '2026-08-25')).not.toBe(seedFor('user:2', '2026-08-25'));
    expect(seedFor('user:1', '2026-08-25')).not.toBe(seedFor('user:1', '2026-08-26'));
  });
});

describe('permuteIndex', () => {
  it('is a bijection over the whole range', () => {
    for (const n of [1, 2, 7, 64, 1000]) {
      const seen = new Set<number>();
      for (let i = 0; i < n; i++) {
        const p = permuteIndex(i, n, 12345);
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThan(n);
        seen.add(p);
      }
      expect(seen.size, `n=${n}`).toBe(n);
    }
  });

  it('produces different orderings for different seeds', () => {
    const n = 500;
    const a = Array.from({ length: n }, (_, i) => permuteIndex(i, n, 111));
    const b = Array.from({ length: n }, (_, i) => permuteIndex(i, n, 222));
    expect(a).not.toEqual(b);
  });

  it('handles n = 0 without dividing by zero', () => {
    expect(permuteIndex(0, 0, 42)).toBe(0);
  });
});

describe('sliceFor', () => {
  it('never repeats an index while paging through the space', () => {
    const seen = new Set<number>();
    for (let cursor = 0; cursor < 100; cursor += 10) {
      for (const idx of sliceFor('user:1', '2026-08-25', 1000, cursor, 10)) {
        expect(seen.has(idx)).toBe(false);
        seen.add(idx);
      }
    }
    expect(seen.size).toBe(100);
  });

  it('gives two callers largely disjoint first pages', () => {
    const a = sliceFor('user:1', '2026-08-25', 5000, 0, 20);
    const b = sliceFor('user:2', '2026-08-25', 5000, 0, 20);
    expect(a.filter((i) => b.includes(i)).length).toBeLessThanOrEqual(2);
  });

  it('stops at the end of the space instead of wrapping', () => {
    expect(sliceFor('user:1', '2026-08-25', 15, 10, 10)).toHaveLength(5);
    expect(sliceFor('user:1', '2026-08-25', 15, 20, 10)).toHaveLength(0);
  });

  it('returns nothing for an empty space', () => {
    expect(sliceFor('user:1', '2026-08-25', 0, 0, 10)).toEqual([]);
  });
});
