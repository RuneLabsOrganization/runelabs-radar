import { beforeEach, describe, expect, it } from 'vitest';
import { metricPoints } from '@/lib/db/schema';
import { zScore } from '@/lib/science/math';
import { detectLaunchSpikes } from '@/lib/science/anomaly';
import { useTestDb } from './helpers/db';
import type { Db } from '@/lib/db';

let db: Db;

beforeEach(() => {
  db = useTestDb();
});

describe('zScore with a degenerate (zero-stdev) baseline', () => {
  it('does not manufacture a 3σ spike from a small uptick on a flat baseline', () => {
    // flat 2/day hitting 3 was previously published as "3.0σ above baseline"
    expect(zScore(3, [2, 2, 2, 2, 2, 2, 2])).toBe(0);
    expect(zScore(4, [2, 2, 2, 2])).toBe(0);
  });

  it('stays silent on low-volume baselines even for large relative jumps', () => {
    // mean < 5: a 2/day sector doubling to 10 is still noise, not an anomaly
    expect(zScore(10, [2, 2, 2, 2])).toBe(0);
    expect(zScore(6, [0, 0, 0, 0])).toBe(0);
  });

  it('requires at least a doubling on a healthy flat baseline', () => {
    expect(zScore(7, [6, 6, 6, 6])).toBe(0);
    // 6/day → 13 clears the bar: Poisson z = 7/√6 ≈ 2.86
    expect(zScore(13, [6, 6, 6, 6])).toBeCloseTo(7 / Math.sqrt(6), 5);
  });

  it('never goes negative-side on a flat baseline', () => {
    expect(zScore(2, [2, 2, 2])).toBe(0);
    expect(zScore(1, [2, 2, 2])).toBe(0);
  });

  it('treats an empty baseline as degenerate, not as a spike', () => {
    expect(zScore(5, [])).toBe(0);
  });
});

describe('zScore with a real (nonzero-stdev) baseline — unchanged', () => {
  const baseline = [2, 4, 2, 4, 3]; // mean 3, population std √0.8

  it('scores against the sample spread as before', () => {
    expect(zScore(10, baseline)).toBeCloseTo(7 / Math.sqrt(0.8), 5);
    expect(zScore(1, baseline)).toBeCloseTo(-2 / Math.sqrt(0.8), 5);
    expect(zScore(3, baseline)).toBeCloseTo(0, 10);
  });
});

// --- detector level: the same rule holds where z ≥ 2 publishes an anomaly ---

function seedLaunchCounts(category: string, byDaysAgo: { daysAgo: number; count: number }[]): void {
  for (const { daysAgo, count } of byDaysAgo) {
    db.insert(metricPoints)
      .values({
        source: 'launches',
        entity: category,
        metric: 'count',
        value: count,
        date: new Date(Date.now() - daysAgo * 864e5).toISOString().slice(0, 10),
        createdAt: new Date(),
      })
      .run();
  }
}

describe('detectLaunchSpikes', () => {
  it('a flat 2/day category hitting 4 yesterday is NOT an anomaly', () => {
    seedLaunchCounts(
      'ai-coding',
      [8, 7, 6, 5, 4, 3, 2].map((daysAgo) => ({ daysAgo, count: 2 })).concat([{ daysAgo: 1, count: 4 }]),
    );
    expect(detectLaunchSpikes()).toEqual([]);
  });

  it('a flat 6/day category hitting 13 yesterday IS an anomaly', () => {
    seedLaunchCounts(
      'ai-coding',
      [8, 7, 6, 5, 4, 3, 2].map((daysAgo) => ({ daysAgo, count: 6 })).concat([{ daysAgo: 1, count: 13 }]),
    );
    const spikes = detectLaunchSpikes();
    expect(spikes).toHaveLength(1);
    expect(spikes[0]!.kind).toBe('launch-spike');
    expect(spikes[0]!.subject).toBe('ai-coding');
    expect(spikes[0]!.score).toBeGreaterThanOrEqual(2);
  });
});
