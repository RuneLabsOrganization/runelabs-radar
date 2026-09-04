import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { TIER_PRICES, entitlementFor, planQuota, quotaFor, type Tier } from './billing';
import { getDb } from './db';
import { llmCalls, metricPoints, users } from './db/schema';
import { UNMETERED_COST_USD } from './llm/pricing';
import { utcDay } from './metrics';
import { CALLS_PER_PLAN, PLAN_PHASE_COUNT } from './plans/generate';
import { median } from './stats';

export { CALLS_PER_PLAN };

const DAY_MS = 864e5;

/** True for rows whose model had no price entry — never a real (negative) cost. */
function isUnmetered(estCostUsd: number): boolean {
  return estCostUsd === UNMETERED_COST_USD;
}

export interface DailyCost {
  date: string; // YYYY-MM-DD (UTC)
  calls: number;
  costUsd: number;
  /** Calls excluded from costUsd because their model has no price entry. */
  unmetered: number;
}

/** Daily metered LLM cost (zero-filled) over the trailing window — the 7d chart series. */
export function dailyLlmCost(days = 30): DailyCost[] {
  const db = getDb();
  const rows = db
    .select({ ts: llmCalls.ts, estCostUsd: llmCalls.estCostUsd })
    .from(llmCalls)
    .where(gte(llmCalls.ts, new Date(Date.now() - days * DAY_MS)))
    .all();

  const byDate = new Map<string, DailyCost>();
  for (let i = 0; i < days; i++) {
    const date = utcDay(new Date(Date.now() - (days - 1 - i) * DAY_MS));
    byDate.set(date, { date, calls: 0, costUsd: 0, unmetered: 0 });
  }
  for (const row of rows) {
    const bucket = byDate.get(utcDay(row.ts));
    if (!bucket) continue;
    bucket.calls += 1;
    if (isUnmetered(row.estCostUsd)) bucket.unmetered += 1;
    else bucket.costUsd += row.estCostUsd;
  }
  return [...byDate.values()];
}

interface Accumulator {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  unmetered: number;
  durationMs: number;
}

function newAccumulator(): Accumulator {
  return { calls: 0, promptTokens: 0, completionTokens: 0, costUsd: 0, unmetered: 0, durationMs: 0 };
}

function finish(acc: Accumulator) {
  return {
    calls: acc.calls,
    promptTokens: acc.promptTokens,
    completionTokens: acc.completionTokens,
    costUsd: acc.costUsd,
    unmetered: acc.unmetered,
    avgDurationMs: Math.round(acc.durationMs / acc.calls),
  };
}

function addRow(acc: Accumulator, row: { promptTokens: number; completionTokens: number; durationMs: number; estCostUsd: number }): void {
  acc.calls += 1;
  acc.promptTokens += row.promptTokens;
  acc.completionTokens += row.completionTokens;
  if (isUnmetered(row.estCostUsd)) acc.unmetered += 1;
  else acc.costUsd += row.estCostUsd;
  acc.durationMs += row.durationMs;
}

export interface FeatureUsage {
  feature: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  unmetered: number;
  avgDurationMs: number;
}

/** Per-feature aggregates over the trailing window, most expensive first. */
export function llmUsageByFeature(days = 30): FeatureUsage[] {
  const db = getDb();
  const rows = db
    .select({
      feature: llmCalls.feature,
      promptTokens: llmCalls.promptTokens,
      completionTokens: llmCalls.completionTokens,
      durationMs: llmCalls.durationMs,
      estCostUsd: llmCalls.estCostUsd,
    })
    .from(llmCalls)
    .where(gte(llmCalls.ts, new Date(Date.now() - days * DAY_MS)))
    .all();

  const byFeature = new Map<string, Accumulator>();
  for (const row of rows) {
    const acc = byFeature.get(row.feature) ?? newAccumulator();
    addRow(acc, row);
    byFeature.set(row.feature, acc);
  }
  return [...byFeature.entries()]
    .map(([feature, acc]) => ({ feature, ...finish(acc) }))
    .sort((a, b) => b.costUsd - a.costUsd || a.feature.localeCompare(b.feature));
}

export interface UserUsage {
  /** null = pipeline / anonymous (worker jobs, unauthenticated MCP calls). */
  userId: number | null;
  /** users.name; null for pipeline rows or a userId without a users row. */
  name: string | null;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  unmetered: number;
  avgDurationMs: number;
}

/** Per-user aggregates over the trailing window (left join users for the name), most expensive first. */
export function llmUsageByUser(days = 30): UserUsage[] {
  const db = getDb();
  const rows = db
    .select({
      userId: llmCalls.userId,
      name: users.name,
      promptTokens: llmCalls.promptTokens,
      completionTokens: llmCalls.completionTokens,
      durationMs: llmCalls.durationMs,
      estCostUsd: llmCalls.estCostUsd,
    })
    .from(llmCalls)
    .leftJoin(users, eq(llmCalls.userId, users.id))
    .where(gte(llmCalls.ts, new Date(Date.now() - days * DAY_MS)))
    .all();

  const byUser = new Map<number | null, Accumulator & { name: string | null }>();
  for (const row of rows) {
    const acc = byUser.get(row.userId) ?? { ...newAccumulator(), name: row.name };
    addRow(acc, row);
    byUser.set(row.userId, acc);
  }
  return [...byUser.entries()]
    .map(([userId, acc]) => ({ userId, name: acc.name, ...finish(acc) }))
    .sort((a, b) => b.costUsd - a.costUsd || b.calls - a.calls);
}

export interface PlanCostStats {
  /** Calls with feature='plan' or 'plan-phase' in the window. */
  calls: number;
  /** Calls excluded from every cost figure — model has no price entry. */
  unmetered: number;
  totalCostUsd: number;
  avgCostPerCallUsd: number | null;
  /** Mean cost of feature='plan' frame rows; null when none are metered. */
  avgFrameCostUsd: number | null;
  /** Mean cost of feature='plan-phase' rows; null when none are metered. */
  avgPhaseCostUsd: number | null;
  /** Phase calls per generation, from the plan pipeline (plans/generate.ts). */
  phasesPerPlan: number;
  /**
   * Estimated cost of one full plan generation: mean frame cost + mean phase
   * cost × phasesPerPlan — measured by structure, not avg-per-call ×
   * CALLS_PER_PLAN, because the frame carries the big context; averaging it
   * into the phase population would dilute the frame and bias the per-plan
   * figure whenever the frame's cost share differs from a phase's. Null until
   * at least one frame AND one phase row are metered (a partial population
   * would understate rather than estimate).
   */
  avgCostPerPlanUsd: number | null;
}

/** Cost-per-plan card data: 'plan' (frame) + 'plan-phase' rows — count, total cost, per-call/frame/phase means and per-generation estimate. */
export function planCostStats(days = 30): PlanCostStats {
  const db = getDb();
  const rows = db
    .select({ feature: llmCalls.feature, estCostUsd: llmCalls.estCostUsd })
    .from(llmCalls)
    .where(and(inArray(llmCalls.feature, ['plan', 'plan-phase']), gte(llmCalls.ts, new Date(Date.now() - days * DAY_MS))))
    .all();

  let unmetered = 0;
  const frameCosts: number[] = [];
  const phaseCosts: number[] = [];
  for (const r of rows) {
    if (isUnmetered(r.estCostUsd)) {
      unmetered += 1;
      continue;
    }
    (r.feature === 'plan' ? frameCosts : phaseCosts).push(r.estCostUsd);
  }

  const metered = frameCosts.length + phaseCosts.length;
  const totalCostUsd = frameCosts.reduce((a, c) => a + c, 0) + phaseCosts.reduce((a, c) => a + c, 0);
  const meanOf = (xs: number[]) => (xs.length === 0 ? null : xs.reduce((a, c) => a + c, 0) / xs.length);
  const avgFrameCostUsd = meanOf(frameCosts);
  const avgPhaseCostUsd = meanOf(phaseCosts);
  return {
    calls: rows.length,
    unmetered,
    totalCostUsd,
    avgCostPerCallUsd: metered === 0 ? null : totalCostUsd / metered,
    avgFrameCostUsd,
    avgPhaseCostUsd,
    phasesPerPlan: PLAN_PHASE_COUNT,
    avgCostPerPlanUsd:
      avgFrameCostUsd === null || avgPhaseCostUsd === null
        ? null
        : avgFrameCostUsd + avgPhaseCostUsd * PLAN_PHASE_COUNT,
  };
}

/** The assumption behind marginByTier's headline figures — surfaced on /admin/usage so the worst case is never read as the expected case. */
export const MARGIN_ASSUMPTION = 'worst-case at 100% quota burn';

export interface TierMargin {
  tier: Tier;
  /** Monthly subscription price from billing.ts TIER_PRICES. */
  priceUsd: number;
  /** Monthly plan quota from billing.ts quotaFor — the same source the gates use. */
  quotaPlans: number;
  /** avgCostPerPlanUsd × quota; null until a plan generation is metered. */
  estMonthlyCostUsd: number | null;
  marginUsd: number | null;
  /** null for the free tier (no price to divide by) and when cost is unknown. */
  marginPct: number | null;
  /** The headline figures assume every subscriber burns their full quota. */
  assumption: typeof MARGIN_ASSUMPTION;
  /**
   * Expected-variant figures at the observed median subscriber utilization
   * (medianPlanUtilization), alongside the worst case. Null when there is no
   * utilization signal or no metered plan cost yet.
   */
  expected: { estMonthlyCostUsd: number; marginUsd: number; marginPct: number | null } | null;
}

/** Margin view: monthly tier price vs measured avg plan cost × tier quota (quotaFor). */
export function marginByTier(avgCostPerPlanUsd: number | null, utilization: number | null = null): TierMargin[] {
  return (Object.keys(TIER_PRICES) as Tier[]).map((tier) => {
    const priceUsd = TIER_PRICES[tier];
    const quotaPlans = quotaFor(tier);
    const estMonthlyCostUsd = avgCostPerPlanUsd === null ? null : avgCostPerPlanUsd * quotaPlans;
    const marginUsd = estMonthlyCostUsd === null ? null : priceUsd - estMonthlyCostUsd;
    const marginPct = marginUsd === null || priceUsd === 0 ? null : (marginUsd / priceUsd) * 100;
    let expected: TierMargin['expected'] = null;
    if (avgCostPerPlanUsd !== null && utilization !== null) {
      const expCost = avgCostPerPlanUsd * quotaPlans * utilization;
      const expMargin = priceUsd - expCost;
      expected = {
        estMonthlyCostUsd: expCost,
        marginUsd: expMargin,
        marginPct: priceUsd === 0 ? null : (expMargin / priceUsd) * 100,
      };
    }
    return { tier, priceUsd, quotaPlans, estMonthlyCostUsd, marginUsd, marginPct, assumption: MARGIN_ASSUMPTION, expected };
  });
}

/**
 * Median share of the monthly plan quota burned in the window by users who
 * generated at least one plan (feature='plan' rows are one per generation —
 * billing.usageThisCycle counts the same rows; the 30d window approximates
 * one billing cycle). Quotas come from entitlementFor/planQuota, the same
 * source the gates use; users with no entitlement row count against the
 * free-tier default. Pipeline/anonymous rows (userId null) are not
 * subscribers and are excluded. Null when nobody generated a plan.
 */
export function medianPlanUtilization(days = 30): number | null {
  const db = getDb();
  const rows = db
    .select({ userId: llmCalls.userId, plans: sql<number>`count(*)` })
    .from(llmCalls)
    .where(and(eq(llmCalls.feature, 'plan'), gte(llmCalls.ts, new Date(Date.now() - days * DAY_MS))))
    .groupBy(llmCalls.userId)
    .all();
  const shares: number[] = [];
  for (const r of rows) {
    if (r.userId === null) continue;
    const quota = planQuota(entitlementFor(r.userId));
    if (quota > 0) shares.push(r.plans / quota);
  }
  return median(shares);
}

export interface DivergencePoint {
  entity: string;
  value: number;
  date: string;
}

/**
 * Latest radar-score↔AA divergence points (§6e calibration). The science job
 * that writes them is parallel work — returns [] until the first nightly run.
 */
export function radarScoreDivergence(limit = 10): DivergencePoint[] {
  const db = getDb();
  return db
    .select({ entity: metricPoints.entity, value: metricPoints.value, date: metricPoints.date })
    .from(metricPoints)
    .where(and(eq(metricPoints.source, 'radar-score'), eq(metricPoints.metric, 'aa_divergence')))
    .orderBy(desc(metricPoints.date), desc(metricPoints.id))
    .limit(limit)
    .all();
}

export interface UsageReport {
  windowDays: number;
  totalCalls: number;
  totalCostUsd: number;
  /** Calls in the window excluded from costUsd — model has no price entry. */
  totalUnmetered: number;
  daily: DailyCost[];
  byFeature: FeatureUsage[];
  byUser: UserUsage[];
  planCost: PlanCostStats;
  margins: TierMargin[];
  /** Median subscriber quota burn behind margins[].expected; null when nobody generated. */
  marginUtilization: number | null;
  divergence: DivergencePoint[];
}

/** The full 7d/7e aggregate bundle — one call behind the /admin/usage page and the get_usage tool. */
export function usageReport(days = 30): UsageReport {
  const daily = dailyLlmCost(days);
  const planCost = planCostStats(days);
  const marginUtilization = medianPlanUtilization(days);
  return {
    windowDays: days,
    totalCalls: daily.reduce((a, d) => a + d.calls, 0),
    totalCostUsd: daily.reduce((a, d) => a + d.costUsd, 0),
    totalUnmetered: daily.reduce((a, d) => a + d.unmetered, 0),
    daily,
    byFeature: llmUsageByFeature(days),
    byUser: llmUsageByUser(days),
    planCost,
    margins: marginByTier(planCost.avgCostPerPlanUsd, marginUtilization),
    marginUtilization,
    divergence: radarScoreDivergence(),
  };
}
