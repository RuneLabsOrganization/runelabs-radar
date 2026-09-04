import { describe, it, expect } from 'vitest';
import { radarPoint } from '@/components/SpiderChart';

const radius = (p: { x: number; y: number }) => Math.hypot(p.x - 108, p.y - 108);

describe('radarPoint — SpiderChart defensive clamp', () => {
  it('an out-of-contract sub-score (>20) cannot overflow the chart radius', () => {
    // sub-scores are 0–20 by contract; a bad payload used to draw past the rim
    expect(radius(radarPoint(0, 25))).toBeCloseTo(radius(radarPoint(0, 20)));
    expect(radius(radarPoint(3, 100))).toBeCloseTo(radius(radarPoint(3, 20)));
  });

  it('negative values clamp to the hub', () => {
    expect(radius(radarPoint(2, -5))).toBeCloseTo(0);
  });

  it('in-contract values are untouched', () => {
    expect(radarPoint(1, 10)).toEqual(radarPoint(1, 10));
    expect(radius(radarPoint(1, 10))).toBeCloseTo(radius(radarPoint(1, 20)) / 2);
  });
});
