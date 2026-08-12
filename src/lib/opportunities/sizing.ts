import type { OppKpis } from './engine';
import type { SubScores } from './axes';

/**
 * Opportunity size estimate — annualized break-even revenue weighted by the
 * demand signal. This is an ESTIMATE and is labeled as such wherever shown:
 *   size est = price/mo × 12 × break-even customers × (demand ÷ 20)   (USD/yr)
 */
export interface SizeEstimate {
  /** USD/yr estimate; 0 = not renderable */
  usd: number;
  /** true when KPIs are absent and sizing falls back to the demand signal only */
  demandOnly: boolean;
}

export function oppSizeEstimate(kpis: OppKpis | null, sub: SubScores): SizeEstimate {
  const price = kpis?.priceUsd ?? null;
  const breakEven = kpis?.breakEvenCustomers ?? null;
  const demand = sub.demand ?? 0;
  if (price !== null && price > 0 && breakEven !== null && breakEven > 0) {
    return { usd: Math.round(price * 12 * breakEven * (demand / 20)), demandOnly: false };
  }
  if (demand > 0) {
    return { usd: demand * 1000, demandOnly: true };
  }
  return { usd: 0, demandOnly: true };
}

/** Compact money: $900 / $12.5k / $340k / $1.2M. */
export function fmtMoney(usd: number): string {
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (usd >= 10_000) return `$${Math.round(usd / 1000)}k`;
  if (usd >= 1000) return `$${(usd / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `$${Math.round(usd)}`;
}
