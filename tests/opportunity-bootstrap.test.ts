import { describe, expect, it } from 'vitest';
import { bootstrapAssessment } from '@/lib/opportunities/bootstrap';
import type { CommercialProfile } from '@/lib/opportunities/commercial';

function profile(pilotDays?: number): CommercialProfile {
  return {
    businessModel: 'B2B', geography: 'United States', researchedAt: '2026-11-24T00:00:00Z', sources: [],
    ...(pilotDays === undefined ? {} : { execution: { pilotDays, assumptions: 'Estimate from the paid pilot plan.' } }),
  };
}

describe('bootstrapAssessment', () => {
  it.each([
    [800, 250, 18, 60, 5.48],
    [500, 120, 14, 50, 6.14],
    [600, 150, 16, 45, 6.13],
  ])('uses build and operating estimates %s/%s and prefers the paid pilot to the %s-day MVP', (initialCostUsd, monthlyCostUsd, timeToMvpDays, pilotDays, points) => {
    expect(bootstrapAssessment({initialCostUsd, monthlyCostUsd, timeToMvpDays}, profile(pilotDays)))
      .toMatchObject({points, initialCostUsd, monthlyCostUsd, days: pilotDays, daysBasis: 'paid pilot'});
  });

  it('gives half of each weight at the common cash and time anchors and labels MVP fallback', () => {
    const result = bootstrapAssessment({initialCostUsd: 2000, monthlyCostUsd: 1000, timeToMvpDays: 30}, profile());
    expect(result).toMatchObject({points: 5, days: 30, daysBasis: 'MVP'});
    expect(result.assumptions).toContain('100 active payers');
    expect(result.assumptions).toContain('no separate allowance for customer acquisition, partner launch costs or founder pay');
    expect(result.assumptions).toContain('MVP');
  });

  it('preserves partial inputs while giving no cash credit when either cost is unknown', () => {
    for (const costs of [{initialCostUsd: null, monthlyCostUsd: 35}, {initialCostUsd: 75, monthlyCostUsd: null}]) {
      expect(bootstrapAssessment({...costs, timeToMvpDays: null}, profile(30)))
        .toMatchObject({...costs, points: 2.5, days: 30, daysBasis: 'paid pilot'});
    }
  });

  it('distinguishes zero from missing and preserves cash credit when timing is unknown', () => {
    const costs = {initialCostUsd: 0, monthlyCostUsd: 0};
    expect(bootstrapAssessment({...costs, timeToMvpDays: null}, profile())).toMatchObject({points: 5, days: null, daysBasis: null});
    expect(bootstrapAssessment({...costs, timeToMvpDays: 0}, profile())).toMatchObject({points: 10, days: 0, daysBasis: 'MVP'});
    expect(bootstrapAssessment({initialCostUsd: null, monthlyCostUsd: null, timeToMvpDays: null}, profile()).points).toBe(0);
  });

  it('treats invalid estimates as unknown and falls back when the pilot estimate is unusable', () => {
    expect(bootstrapAssessment({initialCostUsd: -1, monthlyCostUsd: Infinity, timeToMvpDays: 30}, profile(NaN)))
      .toMatchObject({points: 2.5, initialCostUsd: null, monthlyCostUsd: null, days: 30, daysBasis: 'MVP'});
  });
});
