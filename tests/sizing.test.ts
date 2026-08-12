import { describe, expect, it } from 'vitest';
import { fmtMoney, oppSizeEstimate } from '@/lib/opportunities/sizing';
import type { OppKpis } from '@/lib/opportunities/engine';
import type { SubScores } from '@/lib/opportunities/axes';

const sub = (demand: number): SubScores => ({
  demand,
  buildability: 0,
  margin: 0,
  competition: 0,
  timing: 0,
  moat: 0,
  regClear: 0,
  platformSafe: 0,
  distribution: 0,
  qualityBar: 0,
});

const kpis = (priceUsd: number | null, breakEvenCustomers: number | null): OppKpis => ({
  initialCostUsd: null,
  monthlyCostUsd: null,
  priceUsd,
  timeToMvpDays: null,
  breakEvenCustomers,
  competitorCount: null,
  competitionNote: null,
  regulatoryNote: null,
});

describe('oppSizeEstimate', () => {
  it('applies the locked formula: price × 12 × break-even × demand/20', () => {
    const out = oppSizeEstimate(kpis(15, 100), sub(16));
    expect(out.demandOnly).toBe(false);
    expect(out.usd).toBe(15 * 12 * 100 * (16 / 20)); // 14400
  });

  it('returns 0 when the demand factor is 0', () => {
    expect(oppSizeEstimate(kpis(15, 100), sub(0)).usd).toBe(0);
  });

  it('falls back to demand-only sizing when KPIs are missing', () => {
    expect(oppSizeEstimate(kpis(null, 100), sub(12))).toEqual({ usd: 12000, demandOnly: true });
    expect(oppSizeEstimate(null, sub(12)).usd).toBe(12000);
  });

  it('returns 0 with nothing to go on', () => {
    expect(oppSizeEstimate(null, sub(0))).toEqual({ usd: 0, demandOnly: true });
    expect(oppSizeEstimate(kpis(0, 100), sub(12)).usd).toBe(12000); // price 0 → fallback
  });
});

describe('fmtMoney', () => {
  it('formats compactly at each scale', () => {
    expect(fmtMoney(900)).toBe('$900');
    expect(fmtMoney(1200)).toBe('$1.2k');
    expect(fmtMoney(12500)).toBe('$13k'); // rounds up from 12.5k
    expect(fmtMoney(340000)).toBe('$340k');
    expect(fmtMoney(1200000)).toBe('$1.2M');
    expect(fmtMoney(1000000)).toBe('$1M');
  });
});
