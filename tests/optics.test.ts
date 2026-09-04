import { describe, expect, it } from 'vitest';
import { OPTICS, opticById } from '@/lib/opportunities/optics';
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

const kpis = (over: Partial<OppKpis>): OppKpis => ({
  initialCostUsd: null,
  monthlyCostUsd: null,
  priceUsd: null,
  timeToMvpDays: null,
  breakEvenCustomers: null,
  competitorCount: null,
  competitionNote: null,
  regulatoryNote: null,
  ...over,
});

describe('optics', () => {
  const flip = opticById('flip');
  const mrr = opticById('mrr');
  const cheap = opticById('cheap');
  const fast = opticById('fast');

  it('flip optic: area is the raw demand signal', () => {
    expect(flip.areaOf(null, sub(14))).toBe(14);
    expect(flip.areaOf(null, sub(0))).toBeNull();
  });

  it('mrr optic: est MRR needs price AND a customer count — never price alone (F9)', () => {
    // pre-fix: price × demand/20 was labeled "est MRR" with no customer count
    // anywhere in the inputs. Now it matches sizing.ts semantics ÷ 12:
    // price × steady-state customers × demand/20, and hatches (null) otherwise.
    expect(mrr.areaOf(kpis({ priceUsd: 30, breakEvenCustomers: 10 }), sub(10))).toBe(150);
    expect(mrr.areaOf(kpis({ priceUsd: 30 }), sub(10))).toBeNull(); // no customers → no MRR claim
    expect(mrr.areaOf(kpis({ breakEvenCustomers: 10 }), sub(10))).toBeNull();
    expect(mrr.areaOf(kpis({ priceUsd: 30, breakEvenCustomers: 0 }), sub(10))).toBeNull();
    expect(mrr.caption).toContain('customers');
  });

  it('cheap optic: demand per $1k of initial cost', () => {
    expect(cheap.areaOf(kpis({ initialCostUsd: 4000 }), sub(16))).toBeCloseTo(4);
    expect(cheap.areaOf(kpis({}), sub(16))).toBeNull();
  });

  it('fast optic: demand per day-to-MVP', () => {
    expect(fast.areaOf(kpis({ timeToMvpDays: 10 }), sub(15))).toBeCloseTo(1.5);
    expect(fast.areaOf(kpis({}), sub(15))).toBeNull();
  });

  it('every optic prints its formula and a color label', () => {
    for (const o of OPTICS) {
      expect(o.caption.length).toBeGreaterThan(20);
      expect(o.caption).toContain('area =');
      expect(['flip', 'hold']).toContain(o.colorLabel);
    }
  });

  it('colorOf follows the sort key', () => {
    const scores = { flipScore: 80, holdScore: 60 };
    expect(flip.colorOf(scores, 'flip')).toBe(80);
    expect(mrr.colorOf(scores, 'hold')).toBe(60);
  });
});
