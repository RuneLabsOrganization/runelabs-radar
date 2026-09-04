import { describe, it, expect } from 'vitest';
import { eloBarLayout, eloScaleCaption, ELO_DOMAIN } from '@/components/EloBars';
import type { MediaModel } from '@/lib/analytics';

function model(rank: number, elo: number, name = `m${rank}`): MediaModel {
  return { name, org: null, elo, rank, released: null };
}

describe('eloBarLayout — fixed disclosed domain', () => {
  it('a 5-point span does NOT render a dramatic spread', () => {
    // the regression: 25% floor + min-max made 1100–1105 look like 1100–1400
    const bars = eloBarLayout([model(1, 1105), model(2, 1100)]);
    const widths = bars.map((b) => b.widthPct);
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(2);
  });

  it('a real 300-point spread stays dramatic on the same scale', () => {
    const bars = eloBarLayout([model(1, 1400), model(2, 1100)]);
    expect(bars[0].widthPct).toBeCloseTo(80);
    expect(bars[1].widthPct).toBeCloseTo(20);
  });

  it('sorts defensively by ELO desc — never trusts caller order', () => {
    const bars = eloBarLayout([model(3, 1050), model(1, 1300), model(2, 1200)]);
    expect(bars.map((b) => b.model.elo)).toEqual([1300, 1200, 1050]);
  });

  it('clamps out-of-domain ELOs into the bar range', () => {
    const bars = eloBarLayout([model(1, 1600), model(2, 900)]);
    expect(bars[0].widthPct).toBe(100);
    expect(bars[1].widthPct).toBe(0);
  });
});

describe('eloScaleCaption', () => {
  it('discloses the absolute scale and the actual field span', () => {
    const caption = eloScaleCaption([model(1, 1105), model(2, 1100)]);
    expect(caption).toContain(`${ELO_DOMAIN.min}–${ELO_DOMAIN.max}`);
    expect(caption).toContain('absolute scale');
    expect(caption).toContain('span 5');
  });

  it('is empty for no models', () => {
    expect(eloScaleCaption([])).toBe('');
  });
});
