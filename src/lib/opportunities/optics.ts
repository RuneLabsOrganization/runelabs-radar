import type { SubScores } from './axes';
import type { OppKpis } from './engine';

/**
 * Opportunity-map optics: (area metric, color metric) pairs — the same field of
 * openings viewed through different solopreneur lenses. Every optic prints its
 * formula verbatim under the chart (the honesty contract). areaOf returns null
 * when the metric is missing → the tile falls back to demand-only hatching.
 */
export interface Optic {
  id: string;
  label: string;
  /** one-line formula, rendered under the map */
  caption: string;
  areaOf: (kpis: OppKpis | null, sub: SubScores) => number | null;
  colorOf: (o: { flipScore: number; holdScore: number }, sortKey: 'flip' | 'hold') => number;
  colorLabel: string;
}

const demand = (sub: SubScores): number => sub.demand ?? 0;

export const OPTICS: Optic[] = [
  {
    id: 'flip',
    label: 'best flip',
    caption: 'area = demand signal /20 · brighter = better flip score',
    areaOf: (_k, sub) => (demand(sub) > 0 ? demand(sub) : null),
    colorOf: (o, sortKey) => (sortKey === 'flip' ? o.flipScore : o.holdScore),
    colorLabel: 'flip',
  },
  {
    id: 'mrr',
    label: 'best mrr',
    caption: 'area = est MRR = price/mo × demand÷20 · brighter = better hold score',
    areaOf: (k, sub) =>
      k?.priceUsd != null && k.priceUsd > 0 && demand(sub) > 0
        ? Math.round(k.priceUsd * (demand(sub) / 20))
        : null,
    colorOf: (o, sortKey) => (sortKey === 'flip' ? o.flipScore : o.holdScore),
    colorLabel: 'hold',
  },
  {
    id: 'cheap',
    label: 'cheapest start',
    caption: 'area = demand ÷ initial cost ($k) · brighter = better flip score',
    areaOf: (k, sub) =>
      k?.initialCostUsd != null && k.initialCostUsd > 0 && demand(sub) > 0
        ? demand(sub) / (k.initialCostUsd / 1000)
        : null,
    colorOf: (o, sortKey) => (sortKey === 'flip' ? o.flipScore : o.holdScore),
    colorLabel: 'flip',
  },
  {
    id: 'fast',
    label: 'fastest mvp',
    caption: 'area = demand ÷ days to MVP · brighter = better flip score',
    areaOf: (k, sub) =>
      k?.timeToMvpDays != null && k.timeToMvpDays > 0 && demand(sub) > 0
        ? demand(sub) / k.timeToMvpDays
        : null,
    colorOf: (o, sortKey) => (sortKey === 'flip' ? o.flipScore : o.holdScore),
    colorLabel: 'flip',
  },
];

export function opticById(id: string): Optic {
  return OPTICS.find((o) => o.id === id) ?? OPTICS[0];
}
