import { describe, expect, it } from 'vitest';
import { backoffPollMs } from '@/lib/ingest/ingest';

const POLL = 30 * 60_000; // 30min cadence

/** Deterministic uniform generator (splitmix-style LCG) so the band is pinned without mocking Math.random. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('backoffPollMs (F12 — jittered ingest backoff)', () => {
  it('leaves healthy sources on their exact cadence (no jitter below 3 failures)', () => {
    for (const failures of [0, 1, 2]) {
      expect(backoffPollMs(POLL, failures, lcg(1))).toBe(POLL);
    }
  });

  it('keeps the exponential nominal: failures f ≥ 3 → cadence × 2^(f−2)', () => {
    expect(backoffPollMs(POLL, 3, () => 0.5)).toBeCloseTo(POLL * 2, 0);
    expect(backoffPollMs(POLL, 5, () => 0.5)).toBeCloseTo(POLL * 8, 0);
  });

  it('stays inside the ±25% jitter band at the pinned extremes', () => {
    const nominal = POLL * 2;
    expect(backoffPollMs(POLL, 3, () => 0)).toBeCloseTo(nominal * 0.75, 0);
    expect(backoffPollMs(POLL, 3, () => 0.999999)).toBeLessThanOrEqual(nominal * 1.25);
    expect(backoffPollMs(POLL, 3, () => 0.999999)).toBeGreaterThan(nominal * 1.2);
  });

  it('keeps the mean at the nominal delay across many draws', () => {
    const nominal = POLL * 4; // failures = 4
    const rand = lcg(42);
    const draws = Array.from({ length: 5000 }, () => backoffPollMs(POLL, 4, rand));
    const mean = draws.reduce((a, b) => a + b, 0) / draws.length;
    expect(mean).toBeGreaterThan(nominal * 0.98);
    expect(mean).toBeLessThan(nominal * 1.02);
    // and the draws are genuinely spread, not a point mass
    expect(Math.min(...draws)).toBeLessThan(nominal * 0.8);
    expect(Math.max(...draws)).toBeGreaterThan(nominal * 1.2);
  });

  it('still caps at 6h even at the top of the band', () => {
    const sixHours = 6 * 36e5;
    expect(backoffPollMs(POLL, 20, () => 0.999999)).toBe(sixHours);
    expect(backoffPollMs(POLL, 20, () => 0)).toBeLessThanOrEqual(sixHours);
  });
});
