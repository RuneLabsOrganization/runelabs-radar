import { beforeEach, describe, expect, it } from 'vitest';
import { metricPoints } from '@/lib/db/schema';
import { zScore } from '@/lib/science/math';
import { detectLaunchSpikes } from '@/lib/science/anomaly';
import { scoreChip } from '@/components/AnomalyFeed';
import type { PatternRow } from '@/lib/analytics';
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

describe('zScore with a real (nonzero-stdev) baseline', () => {
  const baseline = [2,4,2,4,3]; // mean 3, sample std 1 (n−1)

  it('scores against the SAMPLE spread for small baselines', () => {
    // JUSTIFICATION for changed constants: these expectations were population
    // std (÷n → √0.8). A baseline of past days is a SAMPLE, and ÷n on tiny
    // baselines underestimates σ by ~1.22×, manufacturing z≥2 "spikes" from
    // noise. sampleStd (÷n−1 → 1) is the unbiased spread.
    expect(zScore(10, baseline)).toBeCloseTo(7, 5);
    expect(zScore(1, baseline)).toBeCloseTo(-2, 5);
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

  it('identical baseline samples + a small deviation do NOT fire', () => {
    // 6/day flat hitting 7: population-std z was inflated (~÷n), and a fixed
    // z≥2 gate on a 7-point baseline is overconfident — the gate widens for
    // small n (z ≥ 2·(1+1/n)) and the flat-baseline Poisson rule wants a
    // doubling. z = 0 here.
    seedLaunchCounts(
      'ai-coding',
      [8, 7, 6, 5, 4, 3, 2].map((daysAgo) => ({ daysAgo, count: 6 })).concat([{ daysAgo: 1, count: 7 }]),
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

  it('a wild ALL-history baseline no longer masks a recent spike (trailing 26d window)', () => {
    // regime drift: months ago the category swung 0↔100 daily; for the last
    // ~3 weeks it has been a steady ~40. Yesterday hit 70 — invisible against
    // all-history (z ≈ 0.6), obvious against the trailing window (z ≫ 2).
    const rows: { daysAgo: number; count: number }[] = [];
    for (let d = 60; d >= 27; d--) rows.push({ daysAgo: d, count: d % 2 === 0 ? 0 : 100 });
    for (let d = 26; d >= 2; d--) rows.push({ daysAgo: d, count: 40 + (d % 3) });
    rows.push({ daysAgo: 1, count: 70 });
    seedLaunchCounts('agents', rows);
    const spikes = detectLaunchSpikes();
    expect(spikes).toHaveLength(1);
    expect(spikes[0]!.subject).toBe('agents');
    expect(spikes[0]!.score).toBeGreaterThanOrEqual(2);
  });

  it('history older than the 26d window is excluded from the baseline entirely', () => {
    // 100/day outliers 30-40 days ago must not enter the z: the score must be
    // exactly zScore against the 5 in-window days, proving the old regime is
    // ignored rather than averaged in
    const rows: { daysAgo: number; count: number }[] = [];
    for (let d = 40; d >= 30; d--) rows.push({ daysAgo: d, count: 100 });
    for (const [d, c] of [[6, 4], [5, 5], [4, 4], [3, 5], [2, 4]] as const) rows.push({ daysAgo: d, count: c });
    rows.push({ daysAgo: 1, count: 9 });
    seedLaunchCounts('devtools', rows);
    const spikes = detectLaunchSpikes();
    expect(spikes).toHaveLength(1);
    expect(spikes[0]!.score).toBeCloseTo(zScore(9, [4, 5, 4, 5, 4]), 8);
  });
});

describe('scoreChip renders the NATIVE quantity per kind', () => {
  const row = (kind: string, score: number): PatternRow => ({
    kind,
    score,
    subject: 'X',
    headline: 'h',
    detail: 'd',
    date: '2026-08-27',
  });

  it('σ for z-detections, % for price drops', () => {
    expect(scoreChip(row('sector-spike', 2.34))).toBe('2.3σ');
    expect(scoreChip(row('launch-spike', 3))).toBe('3.0σ');
    expect(scoreChip(row('price-drop', 2))).toBe('−20%'); // score is drop·10
  });

  it('"×" appears only for a real (shrunk) week-over-week ratio', () => {
    // regression: a from-zero entity stored score=count and the chip rendered
    // "5×" — a raw count dressed as a ratio
    expect(scoreChip(row('entity-surge', 2.8))).toBe('2.8×');
    expect(scoreChip(row('entity-debut', 5))).toBe('+5');
  });

  it('cluster-heat shows the actual heat, pains the observation count', () => {
    // regression: cluster-heat was 2+size/10, a fabricated ordering unit
    expect(scoreChip(row('cluster-heat', 0.87))).toBe('0.87');
    expect(scoreChip(row('pain-cluster', 4))).toBe('4');
  });
});
