import { describe, expect, it } from 'vitest';
import { economicsLines } from '@/lib/opportunities/critic';
import { kpiEconomics, RUN_COST_USERS } from '@/lib/opportunities/gate';
import type { OppKpis } from '@/lib/opportunities/engine';

const kpis = (over: Partial<OppKpis> = {}): OppKpis => ({
  initialCostUsd: 700,
  monthlyCostUsd: 180,
  priceUsd: 79,
  timeToMvpDays: 14,
  breakEvenCustomers: 35,
  competitorCount: 3,
  competitionNote: null,
  regulatoryNote: null,
  ...over,
});

describe('kpiEconomics', () => {
  it('treats the run cost as a TOTAL for ~100 users, not a per-customer cost', () => {
    // the shape the critic used to reject as "every customer loses money": $79 price vs $180 run cost
    const e = kpiEconomics(kpis());
    expect(RUN_COST_USERS).toBe(100);
    expect(e.perUserRunUsd).toBeCloseTo(1.8, 5);
    expect(e.unitMarginUsd).toBeCloseTo(77.2, 5);
    expect(e.steadyRevenueUsd).toBe(35 * 79);
    expect(e.steadyProfitUsd).toBe(35 * 79 - 180);
    expect(e.paybackMonths).toBeCloseTo(700 / (35 * 79 - 180), 5);
  });

  it('reports a genuinely underwater product as underwater', () => {
    const e = kpiEconomics(kpis({ monthlyCostUsd: 5000, priceUsd: 20, breakEvenCustomers: 30 }));
    expect(e.steadyProfitUsd).toBe(30 * 20 - 5000);
    expect(e.paybackMonths).toBeNull(); // no positive profit → no payback
  });

  it('leaves what it cannot compute null', () => {
    const e = kpiEconomics(kpis({ priceUsd: null, breakEvenCustomers: null, initialCostUsd: null }));
    expect(e.unitMarginUsd).toBeNull();
    expect(e.steadyRevenueUsd).toBeNull();
    expect(e.steadyProfitUsd).toBeNull();
    expect(e.paybackMonths).toBeNull();
    expect(kpiEconomics(null).perUserRunUsd).toBeNull();
  });
});

describe('economicsLines (what the critic is shown)', () => {
  it('spells out the units so total run cost is never compared with one customer price', () => {
    const text = economicsLines(kpis());
    expect(text).toContain('price $79 per customer per month');
    expect(text).toContain('run cost $180/mo TOTAL for ~100 users (≈$2 per user)');
    expect(text).toContain('unit margin ≈$77 per customer');
    expect(text).toContain('steady-state revenue $2,765/mo, $2,585/mo after run cost');
    expect(text).toMatch(/pays back in ≈1 months/);
  });

  it('says so when nothing is stated', () => {
    expect(economicsLines(kpis({ priceUsd: null, monthlyCostUsd: null, breakEvenCustomers: null, initialCostUsd: null }))).toBe(
      'economics: (not stated)',
    );
  });
});
