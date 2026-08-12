import { describe, expect, it } from 'vitest';
import { blipPosition, easeOutExpo, hash01, kpiFormat, tweenNumber } from '@/lib/scope';
import { DOMAINS } from '@/lib/domains';

describe('blipPosition', () => {
  it('keeps every domain blip inside its 60° wedge', () => {
    const wedge = (Math.PI * 2) / DOMAINS.length;
    for (const [i, d] of DOMAINS.entries()) {
      for (let id = 1; id <= 200; id++) {
        const { angle } = blipPosition(d, 70, id);
        const start = i * wedge;
        // normalize angle into [start, start+wedge)
        const rel = (((angle - start) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        expect(rel).toBeLessThanOrEqual(wedge + 1e-9);
      }
    }
  });

  it('radius grows with score (allowing small jitter)', () => {
    // average out jitter over many ids: higher score band must sit farther out
    const avg = (score: number) => {
      let sum = 0;
      for (let id = 1; id <= 100; id++) sum += blipPosition('coding', score, id).r;
      return sum / 100;
    };
    expect(avg(95)).toBeGreaterThan(avg(75));
    expect(avg(75)).toBeGreaterThan(avg(45));
  });

  it('is deterministic per id and stays within (0, 1)', () => {
    expect(blipPosition('video', 80, 42)).toEqual(blipPosition('video', 80, 42));
    for (let id = 1; id <= 500; id++) {
      const { r } = blipPosition(null, 50, id);
      expect(r).toBeGreaterThan(0);
      expect(r).toBeLessThanOrEqual(0.97);
    }
  });
});

describe('hash01', () => {
  it('is deterministic and bounded', () => {
    expect(hash01(7)).toBe(hash01(7));
    for (let id = 0; id < 1000; id++) {
      const h = hash01(id);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(1);
    }
  });
});

describe('tweenNumber / easeOutExpo', () => {
  it('hits exact endpoints', () => {
    expect(tweenNumber(0, 100, 0)).toBe(0);
    expect(tweenNumber(0, 100, 1)).toBe(100);
    expect(easeOutExpo(0)).toBe(0);
    expect(easeOutExpo(1)).toBe(1);
  });

  it('attacks fast and lands softly', () => {
    expect(tweenNumber(0, 100, 0.5)).toBeGreaterThan(80); // most of the way by halfway
    expect(tweenNumber(0, 100, 0.9)).toBeLessThan(100);
  });
});

describe('kpiFormat', () => {
  it('formats small numbers raw and thousands compactly', () => {
    expect(kpiFormat(0)).toBe('0');
    expect(kpiFormat(87)).toBe('87');
    expect(kpiFormat(1000)).toBe('1k');
    expect(kpiFormat(1530)).toBe('1.5k');
  });
});
