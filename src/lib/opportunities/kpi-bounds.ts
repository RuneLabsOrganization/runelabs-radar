/**
 * The ONE set of numeric bounds for LLM-stated economics. Both sanitizers —
 * sanitizeKpis (engine.ts, proposal path) and sanitizeBrief (brief.ts,
 * cached-brief path) — import these so a price that passes one path can never
 * be rejected (or clamped) differently by the other.
 *
 * Pure module: no DB/LLM imports.
 */

export const KPI_BOUNDS = {
  initialCostUsd: 1e6,
  monthlyCostUsd: 1e5,
  priceUsd: 1e4,
  timeToMvpDays: 365,
  breakEvenCustomers: 1e6,
  competitorCount: 500,
} as const;

export type KpiKey = keyof typeof KPI_BOUNDS;

/**
 * Fail-closed numeric sanitize for LLM economics: finite values CLAMP into
 * [0, max] (an out-of-range number still reaches the R8 economics check, with
 * the clamp recorded by the caller) instead of collapsing to null and
 * skipping the check entirely — absurd economics must be evaluated, not
 * waved through. Non-numbers and non-finite values are unclampable → null.
 * Rounds to cents like both legacy sanitizers did.
 */
export function clampKpi(v: unknown, max: number): { value: number | null; clamped: boolean } {
  if (typeof v !== 'number' || !Number.isFinite(v)) return { value: null, clamped: false };
  const bounded = Math.min(max, Math.max(0, v));
  return { value: Math.round(bounded * 100) / 100, clamped: bounded !== v };
}
