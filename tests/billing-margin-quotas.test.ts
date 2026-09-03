import { describe, expect, it } from 'vitest';
import { TIER_PRICES, quotaFor, type Tier } from '@/lib/billing';
import { marginByTier } from '@/lib/usage';

// B4: marginByTier must derive tier quotas from quotaFor (billing-prices.ts,
// the same source the plan gates use) — a hand-mirrored copy can silently
// drift from the actual gate quotas.
describe('marginByTier quota source', () => {
  it('matches quotaFor for every tier', () => {
    const margins = marginByTier(null);
    expect(margins).toHaveLength(Object.keys(TIER_PRICES).length);
    for (const tier of Object.keys(TIER_PRICES) as Tier[]) {
      const row = margins.find((m) => m.tier === tier);
      expect(row?.quotaPlans).toBe(quotaFor(tier));
      expect(row?.priceUsd).toBe(TIER_PRICES[tier]);
    }
  });

  it('scales estimated cost and margin with the derived quota', () => {
    const avg = 0.5;
    const margins = marginByTier(avg);
    for (const row of margins) {
      expect(row.estMonthlyCostUsd).toBeCloseTo(avg * quotaFor(row.tier));
      expect(row.marginUsd).toBeCloseTo(row.priceUsd - avg * quotaFor(row.tier));
      if (row.priceUsd > 0) {
        expect(row.marginPct).toBeCloseTo(((row.priceUsd - avg * quotaFor(row.tier)) / row.priceUsd) * 100);
      } else {
        expect(row.marginPct).toBeNull();
      }
    }
  });

  it('keeps cost and margin null until a plan generation is metered', () => {
    for (const row of marginByTier(null)) {
      expect(row.estMonthlyCostUsd).toBeNull();
      expect(row.marginUsd).toBeNull();
      expect(row.marginPct).toBeNull();
    }
  });
});
