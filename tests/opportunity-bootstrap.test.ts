import { describe, expect, it } from 'vitest';
import { bootstrapAssessment } from '@/lib/opportunities/bootstrap';
import { blendedChannel, parseCommercial, type CommercialProfile } from '@/lib/opportunities/commercial';

function profile(pilotDays?: number): CommercialProfile {
  return {
    businessModel: 'B2B', geography: 'United States', researchedAt: '2026-11-24T00:00:00Z', sources: [],
    ...(pilotDays === undefined ? {} : { execution: { pilotDays, assumptions: 'Estimate from the paid pilot plan.' } }),
  };
}

function cashProfile(): CommercialProfile {
  const common = { usd: { low: 50, base: 100, high: 200 }, assumptions: 'Includes labor.', sourceIds: ['C1'] };
  return { ...profile(30),
    sources: [{ id: 'C1', url: 'https://example.org/cohort', title: 'Cohort', snippet: 'Acquisition costs.', publishedAt: null }],
    cac: { ...common, channel: blendedChannel, kind: 'scenario' }, cacChannels: [
    { ...common, channel: 'Referral', cashUsd: { low: 0, base: 1.01, high: 2.02 } },
    { ...common, channel: 'Search', cashUsd: { low: 10.01, base: 20.02, high: 30.03 } },
  ], channelMix: { usd: common.usd, assumptions: 'Two launch routes.', sourceIds: ['C1'], weights: [
    { channel: 'Search', favorable: 23, base: 33, adverse: 57 },
    { channel: 'Referral', favorable: 77, base: 67, adverse: 43 },
  ] } };
}

const fixedCosts = { initialCostUsd: 2000, monthlyCostUsd: 1000, timeToMvpDays: 90 };

describe('bootstrapAssessment', () => {
  it('weights launch-period cash for ten expected payers and scores base launch cash plus unchanged speed', () => {
    const p = cashProfile();
    const result = bootstrapAssessment(fixedCosts, p);
    expect(result).toMatchObject({
      firstTenCashUsd: { low: 23.02, base: 72.83, high: 179.86 },
      launchCashUsd: { low: 5023.02, base: 5072.83, high: 5179.86 }, points: 4.98, days: 30,
    });
    expect(result.assumptions).not.toContain('no separate allowance for customer acquisition');
    expect(result.assumptions.length).toBeLessThanOrEqual(600);
    expect(parseCommercial({ ...p, bootstrap: result })?.bootstrap).toEqual(result);
  });

  it('rounds each total launch scenario to cents after adding fixed costs', () => {
    const result = bootstrapAssessment({ ...fixedCosts, initialCostUsd: 500.004, monthlyCostUsd: 10.004 }, cashProfile());
    expect(result.launchCashUsd).toEqual({ low: 553.04, base: 602.85, high: 709.88 });
  });

  it('retains acquisition cash when the total launch budget is unknown', () => {
    const result = bootstrapAssessment({ ...fixedCosts, monthlyCostUsd: null }, cashProfile());
    expect(result.firstTenCashUsd?.base).toBe(72.83);
    expect(result.launchCashUsd).toBeUndefined();
    expect(result.points).toBe(2.5);
    expect(result.assumptions).toContain('both build and monthly cost estimates are required');
  });

  it('uses the prior cash formula for unavailable or unmatched channel cash and discloses the omission', () => {
    const p = cashProfile();
    const incomplete = p.cacChannels!.map((c, i) => i === 0 ? { ...c, cashUsd: undefined } : c);
    for (const patch of [{ channelMix: undefined }, { cacChannels: incomplete },
      { cacChannels: p.cacChannels!.map(c => ({ ...c, channel: c.channel + ' changed' })) }]) {
      const result = bootstrapAssessment(fixedCosts, { ...p, ...patch });
      expect(result.points).toBe(5);
      expect(result.firstTenCashUsd).toBeUndefined();
      expect(result.launchCashUsd).toBeUndefined();
      expect(result.assumptions).toContain('no separate allowance for customer acquisition');
    }
  });

  it('keeps a supported zero cash estimate distinct from missing acquisition data', () => {
    const p = cashProfile();
    const zero = { low: 0, base: 0, high: 0 };
    p.cacChannels = p.cacChannels!.map(c => ({ ...c, cashUsd: zero }));
    expect(bootstrapAssessment(fixedCosts, p)).toMatchObject({ firstTenCashUsd: zero,
      launchCashUsd: { low: 5000, base: 5000, high: 5000 }, points: 5 });
  });
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
