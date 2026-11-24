import type { OppKpis } from './engine';
import { kpiEconomics } from './gate';

export type OpportunitySort = 'commercial' | 'flip' | 'hold';

interface Rankable {
  id: number;
  verdict: string;
  flipScore: number;
  holdScore: number;
  commercialScore: number;
}

/** Points on a 100-point prioritization scale. Missing inputs earn no research credit. */
export function commercialScore(flip: number, hold: number, kpis: OppKpis | null): number {
  const baseline = (flip + hold) / 4;
  const profile = kpis?.commercial;
  if (!profile) return Math.round(baseline);

  const { market, cac, execution, competition } = profile;
  const ai = execution?.ai;
  const { perUserRunUsd } = kpiEconomics(kpis);
  const aiCost = ai ? ai.costPerTaskUsd * ai.tasksPerCustomerMonth : null;
  // AI may be included in the operating estimate. Use the higher monthly cost floor.
  const cost = perUserRunUsd === null ? aiCost : Math.max(perUserRunUsd, aiCost ?? 0);
  const price = kpis?.priceUsd;
  const margin = price != null && cost !== null ? price - cost : 0;
  const unitEconomics = price && margin > 0 ? 5 * margin / price : 0;
  // Six-month payback earns half the available acquisition points.
  const adverseCac = profile.channelMix?.usd.high ?? cac?.usd.high;
  const acquisition = adverseCac !== undefined && margin > 0 ? 15 / (1 + adverseCac / margin / 6) : 0;

  // Compare reachable buyers to this opening's customer target, across business models.
  // At 10% penetration of the low market scenario, award half the market points.
  const customers = kpis?.breakEvenCustomers;
  const buyers = market?.buyerCounts.low ?? 0;
  const marketFit = customers != null && customers > 0 && buyers > 0
    ? 10 / (1 + 10 * customers / buyers)
    : 0;
  const executionPoints = profile.bootstrap?.points ?? (execution ? 10 / (1 + execution.pilotDays / 30) : 0);
  const coverage = [
    market?.sourceIds.length || profile.marketReference?.sourceIds.length,
    cac?.sourceIds.length || profile.cacReferences?.some(ref => ref.scope === 'matched'),
    competition?.some((entry) => entry.sourceIds.length > 0),
    ai?.sourceIds.length,
  ].filter(Boolean).length * 2.5;
  return Math.round(baseline + unitEconomics + acquisition + marketFit + executionPoints + coverage);
}

export function opportunityScore(o: Rankable, sort: OpportunitySort): number {
  if (sort === 'commercial') return o.commercialScore;
  return sort === 'flip' ? o.flipScore : o.holdScore;
}

export function compareOpportunities(a: Rankable, b: Rankable, sort: OpportunitySort = 'commercial'): number {
  // Hidden rejects must not displace visible openings at the default page boundary.
  if (sort === 'commercial' && (a.verdict === 'reject') !== (b.verdict === 'reject')) {
    return a.verdict === 'reject' ? 1 : -1;
  }
  return opportunityScore(b, sort) - opportunityScore(a, sort) || a.id - b.id;
}
