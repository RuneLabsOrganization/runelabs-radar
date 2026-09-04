import { describe, expect, it } from 'vitest';
import {
  clamp,
  correlationSignificant,
  mad,
  mean,
  median,
  minMax,
  poissonZ,
  populationStd,
  robustScale,
  roundTo,
  sampleStd,
  shrinkRatio,
} from '@/lib/stats';

describe('mean/median', () => {
  it('mean of empty is NaN, of values is exact', () => {
    expect(Number.isNaN(mean([]))).toBe(true);
    expect(mean([1, 2, 3])).toBe(2);
  });

  it('median is a float, never rounded', () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5); // not 3 — display layers round, not stats
    expect(median([1, 4])).toBe(2.5);
  });
});

describe('spread', () => {
  it('sampleStd uses n−1 and is larger than populationStd', () => {
    const xs = [2, 4, 4, 4, 5, 5, 7, 9];
    expect(populationStd(xs)).toBeCloseTo(2, 5);
    expect(sampleStd(xs)).toBeCloseTo(2.13809, 4);
    expect(sampleStd(xs)).toBeGreaterThan(populationStd(xs));
  });

  it('sampleStd of a single value is 0, not NaN', () => {
    expect(sampleStd([7])).toBe(0);
    expect(sampleStd([])).toBe(0);
  });

  it('mad is robust to one huge outlier', () => {
    const base = [10, 11, 9, 10, 12, 10, 11];
    expect(mad(base)).toBeCloseTo(1, 5);
    // the outlier cannot explode the spread — it shifts the median slightly
    expect(mad([...base, 10_000])).toBeCloseTo(0.5, 5);
    expect(mad([])).toBeNull();
  });
});

describe('minMax / robustScale', () => {
  it('minMax constant input → 0.5', () => {
    expect(minMax(5, 5, 5)).toBe(0.5);
    expect(minMax(0, 0, 10)).toBe(0);
    expect(minMax(10, 0, 10)).toBe(1);
  });

  it('robustScale keeps the cohort spread when one outlier arrives', () => {
    const cohort = [10, 11, 12, 13, 14, 15, 16];
    const midBefore = robustScale(13, cohort);
    const midAfter = robustScale(13, [...cohort, 200_000]);
    // with min-max, 13 would collapse to ~0; robust scaling barely moves it
    expect(Math.abs(midAfter - midBefore)).toBeLessThan(0.15);
    expect(robustScale(200_000, [...cohort, 200_000])).toBeGreaterThan(0.9);
  });

  it('robustScale of a constant cohort is 0.5', () => {
    expect(robustScale(7, [7, 7, 7])).toBe(0.5);
    expect(robustScale(7, [])).toBe(0.5);
  });
});

describe('shrinkRatio / poissonZ', () => {
  it('shrinkRatio tames tiny denominators and converges on large ones', () => {
    expect(shrinkRatio(4, 1, 2)).toBeCloseTo(2, 5); // not "4×"
    expect(shrinkRatio(400, 100, 2)).toBeCloseTo(3.94, 2); // ≈ raw 4.0
    expect(shrinkRatio(0, 0, 2)).toBe(1);
  });

  it('poissonZ is 0 at expectation and guards mean 0', () => {
    expect(poissonZ(5, 5)).toBe(0);
    expect(poissonZ(0, 0)).toBe(0);
    expect(poissonZ(3, 0)).toBe(3);
    expect(poissonZ(15, 5)).toBeCloseTo(10 / Math.sqrt(5), 5);
  });
});

describe('correlationSignificant', () => {
  it('rejects the classic best-of-11-lags false positive on ~20 points', () => {
    // r=0.4 at n=21 clears the naive bar but must not survive 11 comparisons
    expect(correlationSignificant(0.4, 21, 11)).toBe(false);
  });

  it('accepts a genuinely strong correlation on enough points', () => {
    expect(correlationSignificant(0.9, 40, 11)).toBe(true);
    expect(correlationSignificant(0.7, 60, 1)).toBe(true);
  });

  it('rejects tiny samples regardless of r', () => {
    expect(correlationSignificant(0.99, 3, 1)).toBe(false);
  });
});

describe('clamp/roundTo', () => {
  it('clamps and rounds', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(roundTo(1.234, 2)).toBe(1.23);
    expect(roundTo(1.236, 2)).toBe(1.24);
    expect(roundTo(2.5, 0)).toBe(3);
  });
});
